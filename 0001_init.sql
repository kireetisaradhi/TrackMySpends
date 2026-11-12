-- TrackMySpends account data. Run this once on the app's Cloudflare D1 database.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('expense', 'savings')),
  category TEXT NOT NULL,
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  note TEXT NOT NULL DEFAULT '',
  entry_date TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, source_id)
);
CREATE INDEX IF NOT EXISTS entries_user_date_idx ON entries(user_id, entry_date DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS budgets (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, month)
);
