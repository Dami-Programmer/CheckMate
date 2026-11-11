-- CheckMate database tables.
-- Safe to run more than once: each table is created only if it doesn't exist yet.

-- People who may use CheckMate. One invite code per person.
CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Every terms page ever scanned, stored once per unique (cleaned) text.
CREATE TABLE IF NOT EXISTS documents (
  id         SERIAL PRIMARY KEY,
  url        TEXT,
  text_hash  TEXT NOT NULL UNIQUE,
  text       TEXT NOT NULL,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Results of analyzing a document. The shared cache.
-- analysis_version changes when the prompt or checklist changes, so old
-- results aren't reused after an improvement.
CREATE TABLE IF NOT EXISTS analyses (
  id               SERIAL PRIMARY KEY,
  document_id      INTEGER NOT NULL REFERENCES documents(id),
  analysis_version TEXT NOT NULL,
  flags            JSONB NOT NULL,
  score            INTEGER NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (document_id, analysis_version)
);

-- How many NEW (not cached) scans each person ran per day.
CREATE TABLE IF NOT EXISTS usage (
  user_id      INTEGER NOT NULL REFERENCES users(id),
  date         DATE NOT NULL,
  new_analyses INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);

-- "This flag is wrong" feedback from testers.
CREATE TABLE IF NOT EXISTS reports (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  analysis_id INTEGER NOT NULL REFERENCES analyses(id),
  flag        JSONB NOT NULL,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
