-- Which grading term (1, 2 or 3) an activity belongs to.
--
-- Nullable with no backfill, and deliberately so. Nothing in this schema
-- records when a term starts or ends, so there is no correct value to write
-- for the activities that already exist — deriving one from `deadline` would
-- file a teacher's work under a term it was never part of, and an activity
-- with no deadline could not be placed at all. Null therefore means "not said
-- yet", which the gradebook shows as its own "No term" group rather than
-- hiding, so no existing mark drops out of a record because of a column
-- nobody has filled in.
--
-- Additive only: one nullable column on an existing table.

ALTER TABLE "Activity" ADD COLUMN "term" INTEGER;

-- The gradebook and the export both filter a single class down to one term,
-- which is the only read this column has. Composite on (classId, term) so that
-- filter is served by the index rather than by scanning every activity in the
-- class and discarding most of them.
CREATE INDEX "Activity_classId_term_idx" ON "Activity"("classId", "term");
