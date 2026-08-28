-- School.slug — the school code — and the rule for who owns one.
--
-- Two things happen here, and the first is a repair. School.slug has been in
-- schema.prisma and read by the server since school codes shipped, but no
-- migration ever created it: the deploy runs `prisma migrate deploy`
-- (render.yaml), which applies only the files in this folder and never diffs
-- the schema. So the column exists on any database that was reshaped by hand
-- with `db push` and does not exist on one that was not. IF NOT EXISTS covers
-- both, and this migration is the first record of the column that survives.
--
-- The second is the rule change this migration is actually named for.
--
-- ── Claiming a code is not owning it ──
-- The code used to be taken by the INSERT at registration: the column was
-- globally unique, so the first school to submit the form held `sjes-sanj`
-- against every other school from that instant, with nobody having yet
-- checked that the school was real.
--
-- That is the wrong moment. A PENDING registration is unverified by
-- definition — registration is the one door anyone can walk up to — and a
-- REJECTED one has been actively refused. Neither is a school. Both used to
-- hold a code, which meant an invented "San Joaquin Elementary School" could
-- take `sjes-sanj` away from the real San Jose Elementary School permanently,
-- because rejection did not release it either.
--
-- Ownership now belongs to approval, which is the point at which a person has
-- confirmed the school exists. Several PENDING registrations may claim the
-- same code at once; at most one APPROVED school may hold it. That is exactly
-- what a unique index with a WHERE clause says, so the constraint is still the
-- thing that settles a race — it has just moved from the INSERT to the
-- approval. See the approve route in server.js for what happens to the
-- registrations that lose.
ALTER TABLE "School" ADD COLUMN IF NOT EXISTS "slug" TEXT;

-- The old whole-column constraint, dropped by the name Prisma gives one. Also
-- IF EXISTS: on a database that never had the column it was never created.
DROP INDEX IF EXISTS "School_slug_key";

CREATE UNIQUE INDEX IF NOT EXISTS "School_slug_approved_key"
  ON "School"("slug")
  WHERE "status" = 'APPROVED';
