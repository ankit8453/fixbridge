-- Records who accepted which version of the customer or partner terms.
--
-- Append-only proof for disputes: a new version of the terms adds a row and
-- never edits an old one. Rows are erased with the account.
CREATE TYPE "legal_document" AS ENUM ('customer_terms', 'partner_terms');

CREATE TABLE "legal_acceptances" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "document" "legal_document" NOT NULL,
    "version" VARCHAR(32) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(512),

    CONSTRAINT "legal_acceptances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "legal_acceptances_user_id_document_version_key"
    ON "legal_acceptances"("user_id", "document", "version");

ALTER TABLE "legal_acceptances"
    ADD CONSTRAINT "legal_acceptances_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
