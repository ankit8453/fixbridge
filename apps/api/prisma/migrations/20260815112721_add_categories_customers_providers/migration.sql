-- CreateEnum
CREATE TYPE "address_label" AS ENUM ('home', 'shop', 'other');

-- CreateEnum
CREATE TYPE "price_type" AS ENUM ('fixed', 'starting_from', 'inspection_based');

-- CreateEnum
CREATE TYPE "provider_document_type" AS ENUM ('id_proof', 'certificate', 'photo', 'other');

-- CreateEnum
CREATE TYPE "provider_document_status" AS ENUM ('pending');

-- CreateTable
CREATE TABLE "categories" (
    "id" SERIAL NOT NULL,
    "city_id" INTEGER NOT NULL,
    "parent_id" INTEGER,
    "name_key" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "icon" VARCHAR(64),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_profiles" (
    "user_id" UUID NOT NULL,
    "display_name" VARCHAR(120),
    "email" VARCHAR(255),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "label" "address_label" NOT NULL DEFAULT 'other',
    "label_text" VARCHAR(60),
    "address_text" VARCHAR(500) NOT NULL,
    "landmark" VARCHAR(200),
    "city_id" INTEGER NOT NULL,
    "location" geography(Point, 4326) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_profiles" (
    "user_id" UUID NOT NULL,
    "display_name" VARCHAR(120),
    "bio" VARCHAR(1000),
    "years_experience" INTEGER,
    "city_id" INTEGER NOT NULL,
    "base_location" geography(Point, 4326),
    "service_radius_km" INTEGER NOT NULL DEFAULT 5,
    "completeness_score" INTEGER NOT NULL DEFAULT 0,
    "is_listed" BOOLEAN NOT NULL DEFAULT false,
    "assisted_onboarding" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "provider_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "provider_skills" (
    "provider_id" UUID NOT NULL,
    "category_id" INTEGER NOT NULL,
    "experience_note" VARCHAR(300),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_skills_pkey" PRIMARY KEY ("provider_id","category_id")
);

-- CreateTable
CREATE TABLE "provider_price_cards" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "category_id" INTEGER NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "price_type" "price_type" NOT NULL,
    "amount_paise" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "provider_price_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_availability_templates" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "day_of_week" SMALLINT NOT NULL,
    "start_minute" SMALLINT NOT NULL,
    "end_minute" SMALLINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "provider_availability_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_documents" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "doc_type" "provider_document_type" NOT NULL,
    "storage_key" VARCHAR(300) NOT NULL,
    "status" "provider_document_status" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "categories_city_id_is_active_idx" ON "categories"("city_id", "is_active");

-- CreateIndex
CREATE INDEX "categories_parent_id_idx" ON "categories"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "categories_city_id_slug_key" ON "categories"("city_id", "slug");

-- CreateIndex
CREATE INDEX "addresses_user_id_idx" ON "addresses"("user_id");

-- CreateIndex
CREATE INDEX "provider_profiles_city_id_is_listed_idx" ON "provider_profiles"("city_id", "is_listed");

-- CreateIndex
CREATE INDEX "provider_skills_category_id_idx" ON "provider_skills"("category_id");

-- CreateIndex
CREATE INDEX "provider_price_cards_provider_id_is_active_idx" ON "provider_price_cards"("provider_id", "is_active");

-- CreateIndex
CREATE INDEX "provider_availability_templates_provider_id_day_of_week_idx" ON "provider_availability_templates"("provider_id", "day_of_week");

-- CreateIndex
CREATE INDEX "provider_documents_provider_id_doc_type_idx" ON "provider_documents"("provider_id", "doc_type");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_profiles" ADD CONSTRAINT "provider_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_profiles" ADD CONSTRAINT "provider_profiles_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_skills" ADD CONSTRAINT "provider_skills_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "provider_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_skills" ADD CONSTRAINT "provider_skills_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_price_cards" ADD CONSTRAINT "provider_price_cards_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "provider_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_price_cards" ADD CONSTRAINT "provider_price_cards_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_availability_templates" ADD CONSTRAINT "provider_availability_templates_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "provider_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_documents" ADD CONSTRAINT "provider_documents_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "provider_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written additions. Prisma cannot express GIST indexes on Unsupported
-- columns, nor CHECK constraints, so everything below is maintained by hand.
-- ---------------------------------------------------------------------------

-- Spatial indexes. Phase 5 search does ST_DWithin against both of these; without
-- a GIST index that degrades to a sequential scan over every row.
CREATE INDEX "addresses_location_gist_idx" ON "addresses" USING GIST ("location");
CREATE INDEX "provider_profiles_base_location_gist_idx" ON "provider_profiles" USING GIST ("base_location");

-- A partial index over exactly what search will filter on: listed providers in a city.
CREATE INDEX "provider_profiles_listed_city_idx" ON "provider_profiles" ("city_id") WHERE "is_listed" = true;

-- One default address per user, enforced by the database rather than by hoping
-- the service always clears the old default first.
CREATE UNIQUE INDEX "addresses_one_default_per_user_idx" ON "addresses" ("user_id") WHERE "is_default" = true;

-- Availability windows: valid weekday, minute-of-day range, and no overnight
-- windows (end must be strictly after start) — the documented v1 limitation.
ALTER TABLE "provider_availability_templates"
  ADD CONSTRAINT "provider_availability_day_of_week_check" CHECK ("day_of_week" BETWEEN 0 AND 6),
  ADD CONSTRAINT "provider_availability_start_minute_check" CHECK ("start_minute" BETWEEN 0 AND 1439),
  ADD CONSTRAINT "provider_availability_end_minute_check" CHECK ("end_minute" BETWEEN 1 AND 1440),
  ADD CONSTRAINT "provider_availability_range_check" CHECK ("end_minute" > "start_minute");

-- Service radius stays inside the documented 1–25 km band.
ALTER TABLE "provider_profiles"
  ADD CONSTRAINT "provider_profiles_service_radius_check" CHECK ("service_radius_km" BETWEEN 1 AND 25),
  ADD CONSTRAINT "provider_profiles_completeness_check" CHECK ("completeness_score" BETWEEN 0 AND 100),
  ADD CONSTRAINT "provider_profiles_years_experience_check" CHECK ("years_experience" IS NULL OR "years_experience" BETWEEN 0 AND 70);

-- Money is always a non-negative integer number of paise, and is present for
-- exactly the price types that carry an amount.
ALTER TABLE "provider_price_cards"
  ADD CONSTRAINT "provider_price_cards_amount_sign_check" CHECK ("amount_paise" IS NULL OR "amount_paise" >= 0),
  ADD CONSTRAINT "provider_price_cards_amount_presence_check" CHECK (
    ("price_type" = 'inspection_based' AND "amount_paise" IS NULL)
    OR ("price_type" <> 'inspection_based' AND "amount_paise" IS NOT NULL)
  );

-- The taxonomy is two levels deep: a category's parent must itself be a root.
-- This cannot be a CHECK (no subqueries), so it is a trigger.
CREATE OR REPLACE FUNCTION categories_enforce_two_levels() RETURNS trigger AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    IF (SELECT parent_id FROM categories WHERE id = NEW.parent_id) IS NOT NULL THEN
      RAISE EXCEPTION 'category tree is limited to two levels: parent % is not a root', NEW.parent_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER categories_two_levels_trigger
  BEFORE INSERT OR UPDATE ON "categories"
  FOR EACH ROW EXECUTE FUNCTION categories_enforce_two_levels();
