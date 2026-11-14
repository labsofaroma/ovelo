-- Published versions of creator baskets, kept forever so a receipt can point at the exact weights
-- it bought (M5b B3, M5-NEEDS-FROM-M4 #5). Insert-only: UPDATE and DELETE are refused by triggers,
-- and the foreign key is ON DELETE RESTRICT (baskets are archived, never deleted).
CREATE TABLE "basket_versions" (
	"basket_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"ticker" text NOT NULL,
	"allocations" jsonb NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	CONSTRAINT "basket_versions_basket_id_version_pk" PRIMARY KEY("basket_id","version"),
	CONSTRAINT "basket_versions_version_positive" CHECK ("basket_versions"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "basket_versions" ADD CONSTRAINT "basket_versions_basket_id_baskets_id_fk" FOREIGN KEY ("basket_id") REFERENCES "public"."baskets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receipts_basket_idx" ON "receipts" USING btree ("basket_id");
--> statement-breakpoint
CREATE FUNCTION aroma_basket_versions_insert_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'basket_versions is insert-only (% refused)', TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;
--> statement-breakpoint
CREATE TRIGGER basket_versions_no_update_delete
  BEFORE UPDATE OR DELETE ON basket_versions
  FOR EACH ROW EXECUTE FUNCTION aroma_basket_versions_insert_only();
--> statement-breakpoint
CREATE TRIGGER basket_versions_no_truncate
  BEFORE TRUNCATE ON basket_versions
  FOR EACH STATEMENT EXECUTE FUNCTION aroma_basket_versions_insert_only();
