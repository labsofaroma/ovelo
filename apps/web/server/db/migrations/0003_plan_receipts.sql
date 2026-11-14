ALTER TABLE "plans_index" ADD COLUMN "executed_periods" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans_index" ADD COLUMN "periods" integer;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "plan_pda" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "period" integer;--> statement-breakpoint
CREATE INDEX "plans_index_owner_idx" ON "plans_index" USING btree ("owner");--> statement-breakpoint
CREATE INDEX "receipts_plan_idx" ON "receipts" USING btree ("plan_pda","period");--> statement-breakpoint
ALTER TABLE "plans_index" ADD CONSTRAINT "plans_index_executed_nonneg" CHECK ("plans_index"."executed_periods" >= 0);--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_plan_kinds" CHECK ("receipts"."plan_pda" IS NOT NULL OR "receipts"."kind" NOT IN ('plan_create', 'plan_close', 'installment'));--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_period_nonneg" CHECK ("receipts"."period" IS NULL OR "receipts"."period" >= 0);