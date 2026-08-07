-- Section.schoolYear
--
-- Sections had no year of their own; only Class did. A section therefore
-- carried forward indefinitely, so last year's rosters sat alongside this
-- year's with nothing to tell them apart.
--
-- Nullable on purpose. NULL means "year not established", and the application
-- treats that as current rather than archived — hiding a roster that nobody
-- can then find again is the worse failure.

ALTER TABLE "Section" ADD COLUMN "schoolYear" TEXT;

-- Backfill: every existing section is treated as belonging to the current
-- school year. This is a point-in-time constant, not a computed value — the
-- migration must produce the same result whenever it is replayed, so it cannot
-- ask what "now" is. 2026-2027 is the school year in progress on the date this
-- was written (7 August 2026); PH school years run June to March, so August
-- 2026 falls in SY 2026-2027.
UPDATE "Section" SET "schoolYear" = '2026-2027' WHERE "schoolYear" IS NULL;

-- Sections are listed newest-year-first and filtered to the current year, both
-- of which read this column on every load.
CREATE INDEX "Section_schoolYear_idx" ON "Section"("schoolYear");
