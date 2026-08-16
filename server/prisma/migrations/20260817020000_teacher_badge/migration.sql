-- Teacher-authored badges, and the activity that awards one.
--
-- The fifteen built-in badges describe term-long patterns and none of them can
-- say "you passed the drill I set on Tuesday". A teacher names the reward here,
-- picks the activity, and sets the bar in percent.
--
-- Additive only. One new table, two nullable columns on Activity and one on
-- StudentBadge, so every existing row is already valid without a backfill and
-- nothing that grades or reads work today changes behaviour.

CREATE TABLE "TeacherBadge" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT NOT NULL DEFAULT 'award',
    "color" TEXT NOT NULL DEFAULT 'royal',
    "teacherId" TEXT NOT NULL,
    "schoolId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeacherBadge_pkey" PRIMARY KEY ("id")
);

-- The library screen lists one teacher's own badges; that is the only read.
CREATE INDEX "TeacherBadge_teacherId_idx" ON "TeacherBadge"("teacherId");

ALTER TABLE "TeacherBadge" ADD CONSTRAINT "TeacherBadge_teacherId_fkey"
    FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Which badge this activity awards, and the mark that earns it. Both null on
-- every existing activity, which is exactly "this one awards nothing".
ALTER TABLE "Activity" ADD COLUMN "badgeId" TEXT;
ALTER TABLE "Activity" ADD COLUMN "badgePassingScore" INTEGER;

-- ON DELETE SET NULL, not CASCADE: deleting a badge must never take the
-- activity — and every mark recorded against it — with it. The activity just
-- stops awarding anything.
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_badgeId_fkey"
    FOREIGN KEY ("badgeId") REFERENCES "TeacherBadge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Activity_badgeId_idx" ON "Activity"("badgeId");

-- The badge's name as it stood when a learner earned it. Only ever read as a
-- fallback, so that a deleted teacher account cannot blank a trophy already won.
ALTER TABLE "StudentBadge" ADD COLUMN "label" TEXT;
