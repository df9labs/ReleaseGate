-- Public sign-ups: verified addresses, email verification links and daily scan allowances.
CREATE TABLE IF NOT EXISTS verified_users (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, verified_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS verifications (digest TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS scan_usage (day TEXT NOT NULL, bucket TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (day, bucket));
-- Privacy-friendly first-party statistics: daily counters only, no addresses or identifiers.
CREATE TABLE IF NOT EXISTS stats_daily (day TEXT NOT NULL, metric TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (day, metric));
