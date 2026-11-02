-- Users and keys
CREATE TABLE users (
  id TEXT PRIMARY KEY,               -- Clerk userId
  email TEXT,
  name TEXT,
  monthly_cap_usd REAL NOT NULL DEFAULT 10,
  onboarded INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE api_keys (
  user_id TEXT PRIMARY KEY,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  last4 TEXT NOT NULL,
  verified_at INTEGER,
  created_at INTEGER NOT NULL
);

-- Sources and their chunks (chunk text lives here, vectors in Vectorize)
CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  filename TEXT NOT NULL,
  kind TEXT NOT NULL,                -- slides | paper | notes | exam | audio
  mime TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  pages INTEGER,
  duration_s REAL,
  status TEXT NOT NULL,              -- uploading | processing | ready | failed
  progress TEXT,                     -- short human label of the current ingest step
  error TEXT,
  meta TEXT,                         -- JSON: exam style, page sizes, outline
  created_at INTEGER NOT NULL
);
CREATE INDEX sources_owner ON sources(owner_id, created_at);

CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  ord INTEGER NOT NULL,
  text TEXT NOT NULL,
  page INTEGER,
  bbox TEXT,                         -- JSON [x,y,w,h] as fractions of the page
  t_start REAL,
  t_end REAL,
  section_path TEXT
);
CREATE INDEX chunks_source ON chunks(source_id, ord);

-- Courses, sections and versions
CREATE TABLE courses (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,              -- building | ready | failed
  progress TEXT,
  current_version INTEGER NOT NULL DEFAULT 0,
  forked_from TEXT,
  forked_at_version INTEGER,
  exam_source_id TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX courses_owner ON courses(owner_id, updated_at);

CREATE TABLE course_sources (
  course_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  PRIMARY KEY (course_id, source_id)
);

CREATE TABLE sections (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  chapter TEXT NOT NULL,
  concept TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'build', -- build | adapt | fork
  upstream_id TEXT,                  -- for copies: the section this was copied from
  upstream_version INTEGER,          -- upstream section version last taken
  created_at INTEGER NOT NULL
);
CREATE INDEX sections_course ON sections(course_id);

CREATE TABLE section_versions (
  section_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  block_hashes TEXT NOT NULL,        -- JSON array of sha256 of block JSON in R2
  created_at INTEGER NOT NULL,
  PRIMARY KEY (section_id, version)
);

-- A course version is a snapshot: ordered path of sections and the version of each
CREATE TABLE course_versions (
  course_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  kind TEXT NOT NULL,                -- build | mutate | adapt | undo | pull | edit
  summary TEXT NOT NULL,
  path TEXT NOT NULL,                -- JSON array of section ids
  sections TEXT NOT NULL,            -- JSON object sectionId -> section version
  author_id TEXT NOT NULL,
  run_id TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (course_id, version)
);

-- A follower's own changes on a course they don't own
CREATE TABLE overlays (
  user_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  title TEXT NOT NULL,
  block_hashes TEXT NOT NULL,
  base_version INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, course_id, section_id)
);

-- Sharing
CREATE TABLE invites (
  token TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE follows (
  user_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  last_seen_version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, course_id)
);

-- Practice and mastery
CREATE TABLE practice_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  chapter TEXT,
  status TEXT NOT NULL,              -- active | finished
  replan_run_id TEXT,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE TABLE practice_questions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  ord INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  answer TEXT NOT NULL,
  rubric TEXT NOT NULL,
  concept TEXT NOT NULL,
  section_id TEXT,
  style_of TEXT,
  cites TEXT NOT NULL
);
CREATE INDEX pq_session ON practice_questions(session_id, ord);
CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  answer TEXT NOT NULL,
  score REAL NOT NULL,
  correct INTEGER NOT NULL,
  feedback TEXT NOT NULL,
  concept TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX attempts_session ON attempts(session_id);
CREATE TABLE mastery (
  user_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  concept TEXT NOT NULL,
  score REAL NOT NULL,               -- 0..1
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, course_id, concept)
);

-- Agent runs and their human-readable trace
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  course_id TEXT,
  graph TEXT NOT NULL,               -- ingest | buildCourse | mutate | adapt | tutor | research
  status TEXT NOT NULL,              -- running | waiting | kept | undone | done | failed
  input TEXT NOT NULL,
  trace TEXT NOT NULL DEFAULT '[]',
  models TEXT NOT NULL DEFAULT '[]',
  result TEXT,
  cost_usd REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX runs_course ON runs(course_id, created_at);

-- Research (web sources kept apart from course sources)
CREATE TABLE research (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  course_id TEXT,
  question TEXT NOT NULL,
  status TEXT NOT NULL,
  report TEXT,
  created_at INTEGER NOT NULL
);

-- Reading progress per user
CREATE TABLE reads (
  user_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  read_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, section_id)
);
