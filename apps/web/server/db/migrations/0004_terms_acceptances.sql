CREATE TABLE "terms_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet" text NOT NULL,
	"terms_version" text NOT NULL,
	"terms_hash" text NOT NULL,
	"message" text NOT NULL,
	"signature" text NOT NULL,
	"nonce" text NOT NULL,
	"country" text,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "terms_acceptances_nonce_unique" UNIQUE("nonce"),
	CONSTRAINT "terms_acceptances_wallet_version_unique" UNIQUE("wallet","terms_version","terms_hash"),
	CONSTRAINT "terms_acceptances_hash_hex" CHECK ("terms_acceptances"."terms_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "terms_acceptances_country_code" CHECK ("terms_acceptances"."country" IS NULL OR "terms_acceptances"."country" ~ '^[A-Z]{2}$')
);
