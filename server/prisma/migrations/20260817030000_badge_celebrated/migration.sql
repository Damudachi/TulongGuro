-- When the learner was actually shown the "you earned this" moment.
--
-- Distinct from earnedAt: a badge is awarded by whichever dashboard load first
-- computes it, which may be a screen the child never looked at. Null means
-- "owed a celebration", so the moment survives a missed load and fires exactly
-- once, on whatever device they next open.
--
-- Additive only: one nullable column on an existing table.

ALTER TABLE "StudentBadge" ADD COLUMN "celebratedAt" TIMESTAMP(3);

-- Every badge that predates this column counts as already celebrated. Without
-- this backfill, the next dashboard load would hand every learner already
-- holding badges a queue of confetti for wins from weeks ago — which is both
-- confusing and the exact opposite of what a "you just earned this" moment is.
UPDATE "StudentBadge" SET "celebratedAt" = "earnedAt" WHERE "celebratedAt" IS NULL;

-- The only read is "this learner's uncelebrated badges", on every dashboard
-- load. Partial, because the rows that matter are the rare ones: once a badge
-- has been celebrated it never comes back into this query.
CREATE INDEX "StudentBadge_studentId_uncelebrated_idx"
    ON "StudentBadge"("studentId") WHERE "celebratedAt" IS NULL;
