-- Integrity rules that must hold even if application code is wrong (spec §2, §8.3, §12, §16).
-- Applied after the Prisma-generated init migration.

-- ───────── Append-only tables: block UPDATE/DELETE for every role at the trigger level ─────────
CREATE OR REPLACE FUNCTION ts_private.reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY: % on % is not allowed', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_events','tender_versions','bid_versions','overrides'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_append_only ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER %I_append_only BEFORE UPDATE OR DELETE ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION ts_private.reject_mutation()', t, t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I_no_truncate ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER %I_no_truncate BEFORE TRUNCATE ON public.%I
                    FOR EACH STATEMENT EXECUTE FUNCTION ts_private.reject_mutation()', t, t);
  END LOOP;
END $$;

-- ───────── Rule versions: approved content is immutable (spec §2.12, §8.6) ─────────
ALTER TABLE public.rule_versions
  ADD CONSTRAINT rule_versions_approved_has_approver
  CHECK (status NOT IN ('APPROVED','ACTIVE','SUPERSEDED') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL));

CREATE OR REPLACE FUNCTION ts_private.rule_version_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('APPROVED','ACTIVE','SUPERSEDED') THEN
      RAISE EXCEPTION 'RULE_VERSION_IMMUTABLE: cannot delete % rule version', OLD.status USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('APPROVED','ACTIVE','SUPERSEDED') THEN
    -- Only the lifecycle moves APPROVED→ACTIVE→SUPERSEDED (or APPROVED→SUPERSEDED) are allowed, nothing else changes.
    IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status')
       OR NOT (
         NEW.status = OLD.status
         OR (OLD.status = 'APPROVED' AND NEW.status IN ('ACTIVE','SUPERSEDED'))
         OR (OLD.status = 'ACTIVE' AND NEW.status = 'SUPERSEDED')
       ) THEN
      RAISE EXCEPTION 'RULE_VERSION_IMMUTABLE: % rule version cannot be modified', OLD.status USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS rule_versions_immutable ON public.rule_versions;
CREATE TRIGGER rule_versions_immutable BEFORE UPDATE OR DELETE ON public.rule_versions
  FOR EACH ROW EXECUTE FUNCTION ts_private.rule_version_immutable();

-- ───────── Verification honesty (spec §2.2, §8.3) ─────────
ALTER TABLE public.verification_results
  ADD CONSTRAINT verification_results_simulated_mode
  CHECK ((is_simulated AND mode = 'SIMULATED') OR (NOT is_simulated AND mode <> 'SIMULATED'));

-- AUTHORITATIVE_VERIFIED only via a qualifying, non-simulated verification result for that claim.
CREATE OR REPLACE FUNCTION ts_private.claim_has_authoritative_result(p_claim uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.verification_results vr
      JOIN public.verification_requests rq ON rq.id = vr.request_id
     WHERE rq.claim_id = p_claim
       AND NOT vr.is_simulated
       AND (
            (vr.mode IN ('AUTHORIZED_API','PROVIDER_API','ISSUER') AND vr.outcome = 'MATCH')
         OR (vr.mode = 'QR' AND vr.outcome IN ('MATCH','DECODED') AND vr.raw_response_key IS NOT NULL)
         OR (vr.mode = 'DIGITAL_SIGNATURE' AND vr.outcome = 'SIGNATURE_VALID' AND vr.trusted_chain)
         OR (vr.mode = 'OFFICER_ASSISTED' AND vr.outcome = 'MATCH' AND vr.captured_document_id IS NOT NULL)
       )
  )
$$;

CREATE OR REPLACE FUNCTION ts_private.guard_authoritative() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.status = 'AUTHORITATIVE_VERIFIED' OR NEW.verification_status = 'AUTHORITATIVE_VERIFIED')
     AND NOT ts_private.claim_has_authoritative_result(NEW.id) THEN
    RAISE EXCEPTION 'AUTHORITATIVE_VERIFICATION_REQUIRED: claim % has no qualifying verification result', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS claims_guard_authoritative ON public.claims;
CREATE TRIGGER claims_guard_authoritative BEFORE INSERT OR UPDATE ON public.claims
  FOR EACH ROW EXECUTE FUNCTION ts_private.guard_authoritative();

-- ───────── Money and scores sanity ─────────
ALTER TABLE public.requirements ADD CONSTRAINT requirements_weight_nonneg CHECK (weight >= 0);
ALTER TABLE public.scores ADD CONSTRAINT scores_total_range CHECK (total >= 0 AND total <= 100);

-- ───────── Search indexes (spec §18.2) ─────────
CREATE INDEX IF NOT EXISTS tenders_title_trgm ON public.tenders USING gin (title extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS organisations_name_trgm ON public.organisations USING gin (legal_name extensions.gin_trgm_ops);

-- Re-apply the lock-down so every table created so far is covered.
SELECT ts_private.lock_down_all();
