-- Photo of the registering person's own school/employee ID.
--
-- Stores a storage key, not a URL. The file lives in the private
-- `school-verification` bucket rather than the public `uploads` bucket the
-- logo and permit use, because it carries a real person's name, face and
-- employee number. It is handed out only as a short-lived signed link, to an
-- operator holding PLATFORM_ADMIN_KEY.
--
-- Nullable: every school registered before this was required has none, and
-- there is no way to backfill a photograph after the fact.

-- AlterTable
ALTER TABLE "School" ADD COLUMN "registrantIdPath" TEXT;
