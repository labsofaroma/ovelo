CREATE TABLE "trade_cap_days" (
	"wallet" text NOT NULL,
	"day" date NOT NULL,
	"used_raw" numeric(20, 0) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trade_cap_days_wallet_day_pk" PRIMARY KEY("wallet","day"),
	CONSTRAINT "trade_cap_days_used_nonnegative" CHECK ("trade_cap_days"."used_raw" >= 0)
);
--> statement-breakpoint
CREATE TABLE "trade_cap_reservations" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"day" date NOT NULL,
	"amount_raw" numeric(20, 0) NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"resolve_after" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "trade_cap_reservations_amount_positive" CHECK ("trade_cap_reservations"."amount_raw" > 0),
	CONSTRAINT "trade_cap_reservations_status_valid" CHECK ("trade_cap_reservations"."status" IN ('reserved', 'confirmed', 'released'))
);
--> statement-breakpoint
CREATE INDEX "trade_cap_reservations_wallet_status" ON "trade_cap_reservations" USING btree ("wallet","status");