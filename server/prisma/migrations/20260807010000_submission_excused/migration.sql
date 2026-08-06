-- Lets a teacher excuse a student from an activity — illness, a school
-- representation, a family emergency — instead of choosing between leaving it
-- MISSING (reads as delinquent) and inventing a mark.
--
-- Both columns are nullable with no default, so every existing row is "not
-- excused" without a backfill and without claiming anything about work already
-- marked.
--
-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "excusedAt" TIMESTAMP(3),
ADD COLUMN     "excusedReason" TEXT;
