-- Consent recorded at registration.
--
-- The form now gates each upload behind a tick box: the ID cannot be attached
-- until the registrant agrees to hand it over, and the logo cannot be attached
-- until they agree we may display it. These columns are what makes that a
-- record rather than a gesture — a permission nobody can produce afterwards is
-- not a permission.
--
-- Timestamps, not booleans: "when was this given" is the question a consent
-- record exists to answer. Nullable, because schools registered before the
-- boxes existed genuinely did not give one, and defaulting them to a value
-- would be inventing consent that was never asked for.

-- AlterTable
ALTER TABLE "School" ADD COLUMN "idConsentAt" TIMESTAMP(3),
ADD COLUMN "logoConsentAt" TIMESTAMP(3);
