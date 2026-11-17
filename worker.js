const categories = [
  'Groceries', 'Fuel', 'Travel', 'Electricity', 'Eating out', 'Recharge',
  'Rent', 'Other / Misc expenses',
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/ai-help') return env.ASSETS.fetch(request);
    if (request.method !== 'POST') return json({ error: 'Use the AI help button in TrackMySpends.' }, 405);

    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return json({ error: 'This request is not allowed.' }, 403);
    if (!env.AI || !env.AI_RATE_LIMITER) return json({ error: 'AI help is not connected in Cloudflare yet.' }, 503);

    try {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const limit = await env.AI_RATE_LIMITER.limit({ key: `ai-help:${ip}` });
      if (!limit.success) return json({ error: 'Please wait a minute before asking for another tip.' }, 429);

      const raw = await request.text();
      if (raw.length > 5000) return json({ error: 'The summary is too large. Please try again.' }, 413);
      const data = JSON.parse(raw);
      if (!/^\d{4}-\d{2}$/.test(data.month || '')) return json({ error: 'The month is not valid.' }, 400);

      const monthlyBudget = Number(data.monthlyBudget);
      const totalSavings = Number(data.totalSavings);
      const expenseByCategory = Array.isArray(data.expenseByCategory)
        ? data.expenseByCategory.slice(0, categories.length).map(row => ({
            category: String(row?.category || ''),
            amount: Number(row?.amount),
          })).filter(row => categories.includes(row.category) && Number.isFinite(row.amount) && row.amount >= 0)
        : [];
      if (!Number.isFinite(monthlyBudget) || monthlyBudget < 0 || monthlyBudget > 1000000000) {
        return json({ error: 'The budget is not valid.' }, 400);
      }
      if (!Number.isFinite(totalSavings) || totalSavings < 0 || totalSavings > 1000000000) {
        return json({ error: 'The savings total is not valid.' }, 400);
      }

      const summary = {
        month: data.month,
        monthlyExpenseBudget: Math.round(monthlyBudget),
        expenseByCategory: expenseByCategory.map(row => ({ ...row, amount: Math.round(row.amount) })),
        totalExpenses: Math.round(expenseByCategory.reduce((sum, row) => sum + row.amount, 0)),
        totalSavings: Math.round(totalSavings),
      };
      const result = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          {
            role: 'system',
            content: 'You are a kind, practical budgeting helper. Use plain English and Indian rupees. Give at most two short suggestions based only on the summary. Do not give tax, investment, loan, or product advice. Do not shame the person. If spending is over budget, gently say so and suggest one realistic next step. Do not invent missing facts.',
          },
          { role: 'user', content: JSON.stringify(summary) },
        ],
        max_tokens: 140,
        temperature: 0.25,
      });
      const tip = typeof result?.response === 'string' ? result.response.trim() : '';
      if (!tip) return json({ error: 'AI did not return a tip. Please try again.' }, 502);
      return json({ tip });
    } catch {
      return json({ error: 'AI help could not reply right now. Please try again shortly.' }, 503);
    }
  },
};
