-- Flags a submission whose AI score came back outside 0-100 and had to be
-- clamped. Additive and defaulted, so every existing row reads false: no
-- previously graded paper is retroactively marked suspect, which would be a
-- claim this migration has no evidence for.
--
-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "scoreOutOfRange" BOOLEAN NOT NULL DEFAULT false;
