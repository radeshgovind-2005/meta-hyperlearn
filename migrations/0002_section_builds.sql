ALTER TABLE courses ADD COLUMN build_attempt TEXT;

CREATE TABLE section_build_jobs (
  attempt_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  ord INTEGER NOT NULL,
  title TEXT NOT NULL,
  chapter TEXT NOT NULL,
  concept TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  block_hashes TEXT,
  checked INTEGER NOT NULL DEFAULT 0,
  supported INTEGER NOT NULL DEFAULT 0,
  verifier TEXT,
  error TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (attempt_id, section_id)
);
CREATE INDEX section_build_course ON section_build_jobs(course_id, attempt_id);
