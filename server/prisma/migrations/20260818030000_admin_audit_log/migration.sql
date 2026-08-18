-- Record of school-admin access being granted or removed.
--
-- Additive only: a new table with no foreign keys and no change to any
-- existing one. The lack of FKs is deliberate — a demoted admin can later be
-- deleted through the ordinary remove-teacher path, and this history has to
-- survive that rather than cascade away with them.

CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "targetId" TEXT,
    "targetName" TEXT,
    "targetEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- The only read is "recent access changes at this school", newest first.
CREATE INDEX "AdminAuditLog_schoolId_createdAt_idx" ON "AdminAuditLog"("schoolId", "createdAt");
