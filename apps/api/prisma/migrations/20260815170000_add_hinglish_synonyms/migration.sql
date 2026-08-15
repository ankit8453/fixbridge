-- Generated with `prisma migrate diff`, then hand-edited. As in Phase 4, the
-- generated output began with:
--
--   DROP INDEX "addresses_location_gist_idx";
--   DROP INDEX "provider_profiles_base_location_gist_idx";
--
-- Prisma cannot see indexes on `Unsupported` geography columns, so it reads them
-- as drift every single time. They are removed here. Losing them would turn the
-- Phase 5 radius search into a sequential scan. See docs/geo-notes.md.

-- CreateTable
CREATE TABLE "hinglish_synonyms" (
    "id" SERIAL NOT NULL,
    "term" VARCHAR(120) NOT NULL,
    "category_id" INTEGER NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hinglish_synonyms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hinglish_synonyms_category_id_idx" ON "hinglish_synonyms"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "hinglish_synonyms_term_category_id_key" ON "hinglish_synonyms"("term", "category_id");

-- AddForeignKey
ALTER TABLE "hinglish_synonyms" ADD CONSTRAINT "hinglish_synonyms_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written additions.
-- ---------------------------------------------------------------------------

-- Weight is a multiplier on a match, so zero or negative makes no sense.
ALTER TABLE "hinglish_synonyms"
  ADD CONSTRAINT "hinglish_synonyms_weight_check" CHECK ("weight" > 0);

-- Trigram indexes for fuzzy matching. "moter jal gai" has to find
-- "motor jal gayi", and a customer typing on a phone will misspell things.
-- pg_trgm has been enabled since the first migration.
CREATE INDEX "hinglish_synonyms_term_trgm_idx"
  ON "hinglish_synonyms" USING GIN ("term" gin_trgm_ops);

-- Category slugs are searched the same way when no synonym matches.
CREATE INDEX "categories_slug_trgm_idx"
  ON "categories" USING GIN ("slug" gin_trgm_ops);

-- The exact filter the search query runs: listed providers in a city that are
-- also verified. Complements the Phase 3 partial index on is_listed.
CREATE INDEX "provider_skills_category_provider_idx"
  ON "provider_skills" ("category_id", "provider_id");

-- Availability lookups filter on day and window, not just provider.
CREATE INDEX "provider_availability_day_window_idx"
  ON "provider_availability_templates" ("day_of_week", "start_minute", "end_minute")
  WHERE "is_active" = true;

-- Search joins every candidate to its badge, so this wants to be covered.
CREATE INDEX "provider_verification_summaries_badge_provider_idx"
  ON "provider_verification_summaries" ("badge", "provider_id");
