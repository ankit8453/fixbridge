-- The technician's public-facing photo — a separate store from KYC documents
-- with the opposite privacy posture: this is the one file a customer is meant
-- to see, and nothing shows it to anyone until a human approves it.

-- CreateEnum
CREATE TYPE "profile_photo_status" AS ENUM ('draft', 'pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "provider_profile_photos" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "storage_key" VARCHAR(300) NOT NULL,
    "content_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "status" "profile_photo_status" NOT NULL DEFAULT 'draft',
    "uploaded_at" TIMESTAMPTZ(3),
    "reviewed_at" TIMESTAMPTZ(3),
    "reviewed_by_id" UUID,
    "rejection_note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_profile_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "provider_profile_photos_storage_key_key" ON "provider_profile_photos"("storage_key");
CREATE INDEX "provider_profile_photos_provider_id_created_at_idx" ON "provider_profile_photos"("provider_id", "created_at" DESC);
CREATE INDEX "provider_profile_photos_status_uploaded_at_idx" ON "provider_profile_photos"("status", "uploaded_at");

-- AddForeignKey
ALTER TABLE "provider_profile_photos" ADD CONSTRAINT "provider_profile_photos_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "provider_profile_photos" ADD CONSTRAINT "provider_profile_photos_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
