-- The Learning Competencies a curriculum lesson covers, as a JSON array of
-- strings.
--
-- A DepEd curriculum guide states these per week, in their own column, and the
-- extraction read straight past them — keeping a one-or-two sentence summary
-- and discarding the rest. That summary was everything the AI was ever told
-- about what a lesson was for, which is the whole reason a hardcoded Grade 6
-- English competency map existed alongside these tables: it was the only place
-- a specific "evaluate for X, then Y" instruction could come from, and it
-- covered one subject out of every subject a school teaches.
--
-- Nullable with no backfill. The competencies live in the uploaded document,
-- not in this database, so there is nothing here to derive them from — a
-- curriculum parsed before this column existed has none until it is re-parsed,
-- and null leaves grading behaving exactly as it does today.
--
-- Additive only: one nullable column on each of two existing tables.

ALTER TABLE "CurriculumLesson" ADD COLUMN "competencies" TEXT;
ALTER TABLE "ClassLesson" ADD COLUMN "competencies" TEXT;
