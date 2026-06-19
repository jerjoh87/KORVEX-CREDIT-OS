-- ─────────────────────────────────────────────
--  CREDITOS — Atomic credit deduction
--  NOTE: superseded by supabase/schema.sql, which includes this
--  function plus all tables, RLS policies, and indexes.
--  Kept for compatibility — running either file is safe.
-- ─────────────────────────────────────────────

-- Returns TRUE if credits were successfully deducted (or user is on an unlimited plan).
-- Returns FALSE if the user has insufficient credits.
-- Uses FOR UPDATE row-lock so concurrent requests can't both pass the balance check.

CREATE OR REPLACE FUNCTION public.deduct_credits(p_user_id UUID, p_amount INT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_plan    TEXT;
  v_credits INT;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN FALSE;
  END IF;

  SELECT plan, credits
    INTO v_plan, v_credits
    FROM public.profiles
   WHERE id = p_user_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Unlimited plans (including legacy names) never lose credits
  IF v_plan IN ('pro', 'premium', 'business', 'agency', 'enterprise') THEN
    RETURN TRUE;
  END IF;

  -- Insufficient balance
  IF v_credits < p_amount THEN
    RETURN FALSE;
  END IF;

  UPDATE public.profiles
     SET credits = credits - p_amount, updated_at = now()
   WHERE id = p_user_id;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.deduct_credits(UUID, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_credits(UUID, INT) TO service_role;
