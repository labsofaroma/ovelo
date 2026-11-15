-- M11 notifications. `notifications` has had no writer since 0000, so the NOT NULL `event_id`
-- column is added without a backfill; on a table with rows this statement fails loudly instead.

CREATE TABLE "notification_events" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"kind" text NOT NULL,
	"cluster" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fanned_out_at" timestamp with time zone,
	CONSTRAINT "notification_events_cluster_valid" CHECK ("notification_events"."cluster" IN ('mainnet', 'devnet', 'none'))
);
--> statement-breakpoint
CREATE TABLE "notification_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet" text NOT NULL,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"events" jsonb NOT NULL,
	"address" jsonb,
	"verify_code_hash" text,
	"verify_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone,
	CONSTRAINT "notification_subscriptions_wallet_channel" UNIQUE("wallet","channel"),
	CONSTRAINT "notification_subscriptions_code" UNIQUE("verify_code_hash"),
	CONSTRAINT "notification_subscriptions_channel_valid" CHECK ("notification_subscriptions"."channel" IN ('email', 'push', 'telegram')),
	CONSTRAINT "notification_subscriptions_status_valid" CHECK ("notification_subscriptions"."status" IN ('pending', 'active')),
	CONSTRAINT "notification_subscriptions_active_has_address" CHECK ("notification_subscriptions"."status" <> 'active' OR "notification_subscriptions"."address" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "event_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "last_error" text;--> statement-breakpoint
CREATE INDEX "notification_events_pending_idx" ON "notification_events" USING btree ("fanned_out_at","created_at");--> statement-breakpoint
CREATE INDEX "notifications_due_idx" ON "notifications" USING btree ("status","next_attempt_at");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_event_channel" UNIQUE("event_id","channel");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_status_valid" CHECK ("notifications"."status" IN ('pending', 'sent', 'dead'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_attempts_nonneg" CHECK ("notifications"."attempts" >= 0);