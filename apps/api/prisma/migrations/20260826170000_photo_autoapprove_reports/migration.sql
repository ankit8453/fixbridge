-- A technician's own face is their property: photos publish on confirm rather
-- than waiting in a review queue. Moderation becomes reactive — customers
-- report, a human decides, and only then does a photo come down.

-- The old queue states are gone. Nothing has shipped on them yet, so anything
-- mid-flight is simply published (it was going to be approved anyway) and the
-- draft state is untouched.
ALTER TYPE "profile_photo_status" ADD VALUE IF NOT EXISTS 'removed';
-- Existing pending photos publish (they were headed for approval anyway).
UPDATE "provider_profile_photos" SET status = 'approved' WHERE status::text IN ('pending', 'rejected');

-- Reporting: a count on the photo, and one row per reporter so a single upset
-- customer cannot manufacture an ops emergency by reporting fifty times.
ALTER TABLE "provider_profile_photos" ADD COLUMN IF NOT EXISTS "report_count" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "provider_profile_photo_reports" (
    "id" UUID NOT NULL,
    "photo_id" UUID NOT NULL,
    "reporter_id" UUID,
    "reason" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "provider_profile_photo_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "provider_profile_photo_reports_photo_id_reporter_id_key" ON "provider_profile_photo_reports"("photo_id", "reporter_id");
CREATE INDEX IF NOT EXISTS "provider_profile_photo_reports_photo_id_created_at_idx" ON "provider_profile_photo_reports"("photo_id", "created_at");

ALTER TABLE "provider_profile_photo_reports" ADD CONSTRAINT "provider_profile_photo_reports_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "provider_profile_photos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "provider_profile_photo_reports" ADD CONSTRAINT "provider_profile_photo_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP INDEX IF EXISTS "provider_profile_photos_status_uploaded_at_idx";
CREATE INDEX IF NOT EXISTS "provider_profile_photos_status_report_count_idx" ON "provider_profile_photos"("status", "report_count");
