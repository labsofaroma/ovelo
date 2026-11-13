CREATE TABLE "basket_allocations" (
	"basket_id" uuid NOT NULL,
	"mint" text NOT NULL,
	"symbol" text NOT NULL,
	"weight_bps" integer NOT NULL,
	CONSTRAINT "basket_allocations_basket_id_mint_pk" PRIMARY KEY("basket_id","mint"),
	CONSTRAINT "basket_allocations_basket_symbol_unique" UNIQUE("basket_id","symbol"),
	CONSTRAINT "basket_allocations_weight_range" CHECK ("basket_allocations"."weight_bps" BETWEEN 1 AND 10000)
);
--> statement-breakpoint
CREATE TABLE "baskets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_wallet" text,
	"name" text NOT NULL,
	"ticker" text NOT NULL,
	"category" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "baskets_ticker_unique" UNIQUE("ticker"),
	CONSTRAINT "baskets_status_valid" CHECK ("baskets"."status" IN ('draft', 'published', 'archived')),
	CONSTRAINT "baskets_version_positive" CHECK ("baskets"."version" >= 1),
	CONSTRAINT "baskets_published_has_timestamp" CHECK ("baskets"."status" <> 'published' OR "baskets"."published_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "creators" (
	"wallet" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"social" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invite_id" uuid
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_code_hash_unique" UNIQUE("code_hash"),
	CONSTRAINT "invites_max_uses_positive" CHECK ("invites"."max_uses" >= 1),
	CONSTRAINT "invites_uses_in_range" CHECK ("invites"."uses" >= 0 AND "invites"."uses" <= "invites"."max_uses")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet" text NOT NULL,
	"channel" text NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_channel_valid" CHECK ("notifications"."channel" IN ('email', 'push', 'telegram'))
);
--> statement-breakpoint
CREATE TABLE "plans_index" (
	"pda" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"funding_mint" text NOT NULL,
	"nonce" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"next_due_at" timestamp with time zone,
	"last_period" integer,
	"skipped_periods" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_index_owner_funding_nonce_unique" UNIQUE("owner","funding_mint","nonce"),
	CONSTRAINT "plans_index_status_valid" CHECK ("plans_index"."status" IN ('active', 'paused', 'completed', 'closed')),
	CONSTRAINT "plans_index_nonce_raw" CHECK (nonce ~ '^[0-9]+$'),
	CONSTRAINT "plans_index_skipped_nonneg" CHECK ("plans_index"."skipped_periods" >= 0)
);
--> statement-breakpoint
CREATE TABLE "portfolio_snapshots" (
	"wallet" text NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	"holdings" jsonb NOT NULL,
	"value_usd" numeric(38, 6) NOT NULL,
	CONSTRAINT "portfolio_snapshots_wallet_taken_at_pk" PRIMARY KEY("wallet","taken_at"),
	CONSTRAINT "portfolio_snapshots_value_nonneg" CHECK ("portfolio_snapshots"."value_usd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"signature" text PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"basket_id" uuid,
	"kind" text NOT NULL,
	"amount_in" text NOT NULL,
	"mint_in" text NOT NULL,
	"legs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"slot" bigint,
	"block_time" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipts_kind_valid" CHECK ("receipts"."kind" IN ('spot', 'basket', 'plan_create', 'plan_close', 'installment')),
	CONSTRAINT "receipts_status_valid" CHECK ("receipts"."status" IN ('pending', 'confirmed', 'failed')),
	CONSTRAINT "receipts_amount_in_raw" CHECK (amount_in ~ '^[0-9]+$')
);
--> statement-breakpoint
ALTER TABLE "basket_allocations" ADD CONSTRAINT "basket_allocations_basket_id_baskets_id_fk" FOREIGN KEY ("basket_id") REFERENCES "public"."baskets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baskets" ADD CONSTRAINT "baskets_creator_wallet_creators_wallet_fk" FOREIGN KEY ("creator_wallet") REFERENCES "public"."creators"("wallet") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creators" ADD CONSTRAINT "creators_invite_id_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."invites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_basket_id_baskets_id_fk" FOREIGN KEY ("basket_id") REFERENCES "public"."baskets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "baskets_creator_idx" ON "baskets" USING btree ("creator_wallet");--> statement-breakpoint
CREATE INDEX "baskets_status_idx" ON "baskets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "notifications_wallet_idx" ON "notifications" USING btree ("wallet","created_at");--> statement-breakpoint
CREATE INDEX "plans_index_due_idx" ON "plans_index" USING btree ("status","next_due_at");--> statement-breakpoint
CREATE INDEX "receipts_wallet_time_idx" ON "receipts" USING btree ("wallet","block_time");