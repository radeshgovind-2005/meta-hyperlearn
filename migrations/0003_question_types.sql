-- Typed practice questions, streamed writing and confidence ratings
ALTER TABLE practice_sessions ADD COLUMN plan TEXT;
ALTER TABLE practice_sessions ADD COLUMN writing_until INTEGER;
ALTER TABLE practice_questions ADD COLUMN qtype TEXT;
ALTER TABLE practice_questions ADD COLUMN spec TEXT;
ALTER TABLE attempts ADD COLUMN confidence TEXT;
ALTER TABLE attempts ADD COLUMN response TEXT;
