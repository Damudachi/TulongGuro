-- Web Push subscriptions: one row per browser that has agreed to be notified.
--
-- The Notification table above this one records that something happened; it
-- cannot make a phone say so. The bell polls, so it only ever reached someone
-- already looking at it, and the event this system most needs to announce — a
-- grade being released — happens hours after the student closed the app.
--
-- endpoint is UNIQUE because it *is* the device's identity as far as the push
-- service is concerned: a browser that re-subscribes (after a permission
-- re-prompt, a worker update, or a second sign-in) hands back the same string.
-- Without the constraint, one device accumulates a row per subscribe and then
-- receives every notification once per row.
--
-- ON DELETE CASCADE, matching Notification: a deleted account must not leave
-- behind a live channel to a phone.

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
