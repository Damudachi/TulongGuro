-- Record when the AI checker's own numbers disagree on a paper: the headline
-- score not matching the criteria it is meant to be the sum of, or a criterion
-- scored outside the band the model itself labelled it with.
--
-- Nullable and additive, so every existing row reads as "no disagreement
-- recorded" rather than as "checked and consistent" — which is the honest
-- state, since nothing checked them at the time they were graded.
--
-- Text, not a boolean: the flag is only actionable if the teacher is told which
-- two numbers disagree.

ALTER TABLE "Submission" ADD COLUMN "rubricScoreNote" TEXT;
