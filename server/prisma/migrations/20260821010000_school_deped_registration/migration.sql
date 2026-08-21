-- School registration proof-of-existence columns.
--
-- These were added to schema.prisma when registration started demanding a
-- DepEd School ID, but no migration was ever written for them, so every
-- deployed database was missing the columns the client was selecting. Any
-- query touching School — including login — failed on `depedSchoolId`.
--
-- All columns are nullable: schools registered before the ID was required
-- have none, and backfilling is a manual, per-school judgement.

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "depedSchoolId" TEXT,
ADD COLUMN     "officialName" TEXT,
ADD COLUMN     "proofUrl" TEXT,
ADD COLUMN     "registeredIp" TEXT,
ADD COLUMN     "verification" TEXT,
ADD COLUMN     "verificationNote" TEXT;

-- CreateIndex
-- Postgres allows many NULLs under a unique index, so pre-existing schools
-- without an ID do not collide with each other.
CREATE UNIQUE INDEX "School_depedSchoolId_key" ON "School"("depedSchoolId");
