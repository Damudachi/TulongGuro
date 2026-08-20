-- Where one scanned page ends and the next begins inside a stitched
-- submission image, as a JSON array of fractions of the image's height.
--
-- Multi-page work is flattened into a single tall image on upload, and nothing
-- recorded the seams. That made a page unremovable on its own: a duplicate or
-- a mis-shot page could only be dealt with by deleting the whole submission —
-- its grade and feedback with it — and re-scanning every page.
--
-- Nullable and additive, so rows uploaded before this read as "boundaries
-- unknown" and keep the all-or-nothing Remove, rather than being mistaken for
-- single-page work.

ALTER TABLE "Submission" ADD COLUMN "pageBreaks" TEXT;
