-- ===========================================================================
-- F007 Hotfix: Fix NULL token_hash voor bestaande tickets
-- ===========================================================================
--
-- PROBLEEM: Handmatig aangemaakte tickets hebben token_hash = NULL
-- GEVOLG: scan_ticket RPC kan ze niet vinden (NULL = hash is altijd FALSE)
--
-- OPLOSSING: Update alle tickets waar qr_code bestaat maar token_hash niet
--
-- ===========================================================================

-- Fix bestaande tickets met NULL token_hash
UPDATE ticket_instances
SET token_hash = encode(
  extensions.digest(qr_code::bytea, 'sha256'::text),
  'hex'
)
WHERE qr_code IS NOT NULL
  AND token_hash IS NULL;

-- Rapporteer hoeveel tickets gefixed zijn
DO $$
DECLARE
  v_updated_count INT;
BEGIN
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RAISE NOTICE 'F007 Hotfix: % tickets updated with token_hash', v_updated_count;
END $$;

-- ===========================================================================
-- Preventie: Trigger voor toekomstige tickets
-- ===========================================================================

-- Function om automatisch token_hash te genereren
CREATE OR REPLACE FUNCTION public.generate_token_hash()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Als qr_code is ingevuld maar token_hash niet, genereer hash
  IF NEW.qr_code IS NOT NULL AND NEW.token_hash IS NULL THEN
    NEW.token_hash := encode(
      extensions.digest(NEW.qr_code::bytea, 'sha256'::text),
      'hex'
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger voor INSERT (nieuwe tickets)
DROP TRIGGER IF EXISTS set_token_hash_on_insert ON ticket_instances;
CREATE TRIGGER set_token_hash_on_insert
  BEFORE INSERT ON ticket_instances
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_token_hash();

-- Trigger voor UPDATE (als qr_code wijzigt)
DROP TRIGGER IF EXISTS set_token_hash_on_update ON ticket_instances;
CREATE TRIGGER set_token_hash_on_update
  BEFORE UPDATE OF qr_code ON ticket_instances
  FOR EACH ROW
  WHEN (NEW.qr_code IS DISTINCT FROM OLD.qr_code)
  EXECUTE FUNCTION public.generate_token_hash();

COMMENT ON FUNCTION public.generate_token_hash IS
  'Auto-generate token_hash from qr_code for ticket scanning';

-- ===========================================================================
-- Verificatie
-- ===========================================================================

DO $$
DECLARE
  v_null_hash_count INT;
BEGIN
  -- Check hoeveel tickets nog NULL hash hebben
  SELECT COUNT(*) INTO v_null_hash_count
  FROM ticket_instances
  WHERE qr_code IS NOT NULL AND token_hash IS NULL;

  IF v_null_hash_count > 0 THEN
    RAISE WARNING 'Still % tickets with NULL token_hash and non-NULL qr_code', v_null_hash_count;
  ELSE
    RAISE NOTICE 'All tickets with qr_code now have token_hash ✓';
  END IF;

  -- Verify triggers exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_token_hash_on_insert'
  ) THEN
    RAISE EXCEPTION 'Trigger set_token_hash_on_insert not created';
  END IF;

  RAISE NOTICE 'Triggers installed successfully ✓';
END $$;
