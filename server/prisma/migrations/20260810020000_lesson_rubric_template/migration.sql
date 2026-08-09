-- Link a curriculum lesson (and its per-class copy) to the school RubricTemplate
-- its rubric was saved as.
--
-- Additive and nullable on both tables, so existing rows are untouched and the
-- old behaviour (read the embedded defaultRubric copy) keeps working for every
-- lesson imported before this. No foreign key on purpose: defaultRubric remains
-- the fallback, so a deleted template must degrade to "use the embedded copy"
-- rather than cascade the lesson away or block the delete.

ALTER TABLE "CurriculumLesson" ADD COLUMN "rubricTemplateId" TEXT;
ALTER TABLE "ClassLesson" ADD COLUMN "rubricTemplateId" TEXT;
