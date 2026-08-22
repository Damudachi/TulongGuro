-- Adds payload size and token-usage columns to AiRequestLog, for the
-- developer-only AI metrics dashboard (/dev/ai-metrics): how big each
-- request/response was, and how many tokens the provider billed it for.
--
-- Additive only, all nullable: every row written before this migration keeps
-- reading as it always has, with these five columns simply empty.

ALTER TABLE "AiRequestLog" ADD COLUMN "requestBytes" INTEGER;
ALTER TABLE "AiRequestLog" ADD COLUMN "responseBytes" INTEGER;
ALTER TABLE "AiRequestLog" ADD COLUMN "promptTokens" INTEGER;
ALTER TABLE "AiRequestLog" ADD COLUMN "candidateTokens" INTEGER;
ALTER TABLE "AiRequestLog" ADD COLUMN "totalTokens" INTEGER;
