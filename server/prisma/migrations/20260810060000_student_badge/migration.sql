-- Badges a learner has earned, recorded so they cannot be lost.
--
-- Class Champion depends on how classmates are doing, so a badge computed
-- live would disappear when someone else improved. Additive only: a new
-- table, no change to any existing one.

CREATE TABLE "StudentBadge" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "badgeId" TEXT NOT NULL,
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentBadge_pkey" PRIMARY KEY ("id")
);

-- The union-and-persist path writes with skipDuplicates on every dashboard
-- load, so this pair carries the idempotency rather than application code.
CREATE UNIQUE INDEX "StudentBadge_studentId_badgeId_key" ON "StudentBadge"("studentId", "badgeId");

CREATE INDEX "StudentBadge_studentId_idx" ON "StudentBadge"("studentId");

ALTER TABLE "StudentBadge" ADD CONSTRAINT "StudentBadge_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
