CREATE TABLE IF NOT EXISTS lessons (
  lesson_id TEXT PRIMARY KEY,
  title TEXT,
  language_id TEXT,
  level TEXT,
  tags_json TEXT,
  tasks_count INTEGER,
  data_json TEXT NOT NULL,
  imported_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attempts (
  attempt_id TEXT PRIMARY KEY,
  lesson_id TEXT,
  timestamp_start TEXT,
  timestamp_end TEXT,
  duration_sec INTEGER,
  mode TEXT,
  score_percent REAL,
  points_earned REAL,
  points_max REAL,
  data_json TEXT NOT NULL,
  imported_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attempts_lesson_id ON attempts(lesson_id);
CREATE INDEX IF NOT EXISTS idx_attempts_timestamp_start ON attempts(timestamp_start);

CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash TEXT PRIMARY KEY,
  token_hint TEXT,
  label TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_attempts (
  user_token_hash TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  lesson_id TEXT,
  timestamp_start TEXT,
  timestamp_end TEXT,
  duration_sec INTEGER,
  mode TEXT,
  score_percent REAL,
  points_earned REAL,
  points_max REAL,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_token_hash, attempt_id),
  FOREIGN KEY (user_token_hash) REFERENCES auth_tokens(token_hash)
);

CREATE INDEX IF NOT EXISTS idx_user_attempts_token_ts ON user_attempts(user_token_hash, timestamp_start);

CREATE TABLE IF NOT EXISTS user_lessons (
  user_token_hash TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  title TEXT,
  language_id TEXT,
  level TEXT,
  tags_json TEXT,
  tasks_count INTEGER,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_token_hash, lesson_id),
  FOREIGN KEY (user_token_hash) REFERENCES auth_tokens(token_hash)
);

CREATE INDEX IF NOT EXISTS idx_user_lessons_token_lang ON user_lessons(user_token_hash, language_id);
