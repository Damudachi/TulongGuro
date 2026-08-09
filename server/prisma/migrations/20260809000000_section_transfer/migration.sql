-- Records when a student moved between sections.
--
-- User.sectionId is unchanged and still answers "where are they now". This
-- answers "since when", which is what tells "did not hand it in" apart from
-- "had already left before it was set".
--
-- Additive only: a new table, plus one nullable column with no default, so
-- every existing Submission row is "not created by a transfer" without a
-- backfill and without claiming anything about work already marked.

-- CreateTable
CREATE TABLE "SectionTransfer" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "fromSectionId" TEXT,
    "toSectionId" TEXT,
    "transferredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "schoolId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SectionTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SectionTransfer_studentId_transferredAt_idx" ON "SectionTransfer"("studentId", "transferredAt");

-- CreateIndex
CREATE INDEX "SectionTransfer_fromSectionId_idx" ON "SectionTransfer"("fromSectionId");

-- CreateIndex
CREATE INDEX "SectionTransfer_toSectionId_idx" ON "SectionTransfer"("toSectionId");

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "transferId" TEXT;
