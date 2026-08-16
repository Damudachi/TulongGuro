-- One row per request sent to the model provider, for the Alpha-stage
-- technical observation: request latency, and real consumption against the
-- daily allowance. Both were previously unrecoverable — latency was never
-- measured, and the quota tally is an in-memory counter that resets on restart.
--
-- Additive only: a new table, no change to any existing one, and nothing in
-- the app reads it. Writes are fire-and-forget, so a failure here cannot
-- affect grading.

CREATE TABLE "AiRequestLog" (
    "id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "model" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "outcome" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiRequestLog_pkey" PRIMARY KEY ("id")
);

-- The export script reads by day and by call site; both are range scans.
CREATE INDEX "AiRequestLog_createdAt_idx" ON "AiRequestLog"("createdAt");
CREATE INDEX "AiRequestLog_purpose_createdAt_idx" ON "AiRequestLog"("purpose", "createdAt");
