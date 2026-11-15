CREATE TABLE "fee_share_ledger" (
	"order_id" text PRIMARY KEY NOT NULL,
	"basket_id" uuid NOT NULL,
	"creator_wallet" text NOT NULL,
	"notional_mint" text NOT NULL,
	"notional_raw" numeric(20, 0) NOT NULL,
	"platform_fee_bps" integer NOT NULL,
	"share_bps" integer NOT NULL,
	"fee_raw" numeric(20, 0) NOT NULL,
	"share_raw" numeric(20, 0) NOT NULL,
	"order_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_share_ledger_bps_range" CHECK ("fee_share_ledger"."platform_fee_bps" BETWEEN 0 AND 10000 AND "fee_share_ledger"."share_bps" BETWEEN 0 AND 10000),
	CONSTRAINT "fee_share_ledger_amounts_nonneg" CHECK ("fee_share_ledger"."notional_raw" >= 0 AND "fee_share_ledger"."fee_raw" >= 0 AND "fee_share_ledger"."share_raw" >= 0 AND "fee_share_ledger"."share_raw" <= "fee_share_ledger"."fee_raw")
);
--> statement-breakpoint
CREATE INDEX "fee_share_ledger_creator_idx" ON "fee_share_ledger" USING btree ("creator_wallet","order_at");