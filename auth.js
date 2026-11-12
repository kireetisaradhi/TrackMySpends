const encoder = new TextEncoder();
const SESSION_COOKIE = '__Host-tms_session';
const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

export function dbUnavailable(env) {
  return !env?.DB || typeof env.DB.prepare !== 'function';
}

export function validOrigin(request) {
  const origin = request.headers.get('Origin');
  return !origin || origin === new URL(request.url).origin;
}

export async function readJson(request) {
  const type = request.headers.get('Content-Type') || '';
  if (!type.toLowerCase().includes('application/json')) throw new Error('Send data as JSON.');
  return await request.json();
}

function encodeBase64(bytes) {
  let raw = '';
  for (const byte of new Uint8Array(bytes)) raw += String.fromCharCode(byte);
  return btoa(raw);
}

function decodeBase64(value) {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}

async function sha256(value) {
  return encodeBase64(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

export async function hashPassword(password, saltText) {
  const salt = saltText ? decodeBase64(saltText) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' }, key, 256);
  return { salt: encodeBase64(salt), hash: encodeBase64(bits) };
}

export function equalText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function cookieValue(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  for (const part of cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return '';
}

export async function createSession(env, userId) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = encodeBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  const tokenHash = await sha256(token);
  const expiresAt = Date.now() + SESSION_LIFETIME_MS;
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(tokenHash, userId, expiresAt, Date.now()).run();
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_LIFETIME_MS / 1000}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export async function currentUser(request, env) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(`
    SELECT users.id, users.email, users.display_name
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).bind(tokenHash, Date.now()).first();
  return row || null;
}

export async function deleteCurrentSession(request, env) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return;
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
}

export function userPayload(user) {
  return { id: user.id, email: user.email, name: user.display_name };
}
