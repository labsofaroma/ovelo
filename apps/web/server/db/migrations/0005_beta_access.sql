CREATE TABLE "beta_access" (
	"wallet" text PRIMARY KEY NOT NULL,
	"invite_id" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "beta_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "beta_invites_code_hash_unique" UNIQUE("code_hash"),
	CONSTRAINT "beta_invites_hash_hex" CHECK ("beta_invites"."code_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "beta_invites_max_uses_range" CHECK ("beta_invites"."max_uses" >= 1 AND "beta_invites"."max_uses" <= 100),
	CONSTRAINT "beta_invites_uses_in_range" CHECK ("beta_invites"."uses" >= 0 AND "beta_invites"."uses" <= "beta_invites"."max_uses")
);
--> statement-breakpoint
ALTER TABLE "beta_access" ADD CONSTRAINT "beta_access_invite_id_beta_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."beta_invites"("id") ON DELETE restrict ON UPDATE no action;