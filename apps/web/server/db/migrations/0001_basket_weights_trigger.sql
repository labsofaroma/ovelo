-- A published basket's allocation weights must sum to exactly 10,000 bps (REWRITE-PLAN §6).
-- This cannot be a row-level CHECK, so it is a pair of DEFERRED constraint triggers: the sum is
-- verified at COMMIT, which lets a transaction insert the basket and all its allocations together.
-- Drafts may hold partial weights; the rule applies once status = 'published'.
CREATE FUNCTION ovelo_check_basket_weights(target uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  basket_status text;
  total bigint;
BEGIN
  SELECT status INTO basket_status FROM baskets WHERE id = target;
  IF basket_status IS NULL OR basket_status <> 'published' THEN
    RETURN;
  END IF;
  SELECT COALESCE(SUM(weight_bps), 0) INTO total FROM basket_allocations WHERE basket_id = target;
  IF total <> 10000 THEN
    RAISE EXCEPTION 'published basket % has allocation weights summing to % bps, expected 10000', target, total
      USING ERRCODE = 'check_violation', CONSTRAINT = 'basket_weights_sum_10000';
  END IF;
END
$$;
--> statement-breakpoint
CREATE FUNCTION ovelo_basket_allocations_weights_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM ovelo_check_basket_weights(OLD.basket_id);
  ELSE
    PERFORM ovelo_check_basket_weights(NEW.basket_id);
    IF TG_OP = 'UPDATE' AND OLD.basket_id <> NEW.basket_id THEN
      PERFORM ovelo_check_basket_weights(OLD.basket_id);
    END IF;
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE FUNCTION ovelo_baskets_weights_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ovelo_check_basket_weights(NEW.id);
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER basket_allocations_weights_sum
  AFTER INSERT OR UPDATE OR DELETE ON basket_allocations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ovelo_basket_allocations_weights_trigger();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER baskets_weights_sum
  AFTER INSERT OR UPDATE OF status ON baskets
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ovelo_baskets_weights_trigger();
