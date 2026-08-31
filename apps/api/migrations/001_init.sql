-- 001_init: core schema for Project Aphelion.
-- Money is stored as integer paise (bigint). Idempotency is enforced by a
-- UNIQUE provider_event_id on payment_events. Payment and case state use a
-- version column so a stale event cannot overwrite a newer confirmed state.

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- merchants -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS merchants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- customers -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id       uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  customer_key      text NOT NULL,
  contact_hash      text NOT NULL,
  email             text,
  contact           text,
  opted_out         boolean NOT NULL DEFAULT false,
  prior_successes   integer NOT NULL DEFAULT 0,
  prior_failures    integer NOT NULL DEFAULT 0,
  prior_recoveries  integer NOT NULL DEFAULT 0,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, contact_hash)
);

-- payments --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id           uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  customer_id           uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  provider_payment_id   text NOT NULL UNIQUE,
  order_id              text,
  amount                bigint NOT NULL CHECK (amount >= 0),
  currency              text NOT NULL DEFAULT 'INR',
  method                text,
  state                 text NOT NULL CHECK (state IN ('created', 'authorized', 'captured', 'failed')),
  failure_category      text,
  error_code            text,
  error_reason          text,
  error_source          text,
  description           text,
  version               integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_state ON payments(state);
CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments(customer_id);

DROP TRIGGER IF EXISTS trg_payments_updated_at ON payments;
CREATE TRIGGER trg_payments_updated_at BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- payment_events (webhook idempotency + audit) --------------------------------
CREATE TABLE IF NOT EXISTS payment_events (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_event_id    text NOT NULL UNIQUE,  -- x-razorpay-event-id, the dedup key
  event_type           text NOT NULL,
  provider_payment_id  text,
  payload              jsonb NOT NULL DEFAULT '{}'::jsonb,
  status               text NOT NULL DEFAULT 'received',
  error_text           text,
  received_at          timestamptz NOT NULL DEFAULT now(),
  processed_at         timestamptz
);
CREATE INDEX IF NOT EXISTS idx_payment_events_status ON payment_events(status);

-- recovery_cases --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recovery_cases (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id      uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  customer_id      uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  payment_id       uuid NOT NULL UNIQUE REFERENCES payments(id) ON DELETE CASCADE,
  state            text NOT NULL,
  amount_at_risk   bigint NOT NULL,
  recovered_amount bigint NOT NULL DEFAULT 0,
  attempts         integer NOT NULL DEFAULT 0,
  stop_reason      text,
  escalated        boolean NOT NULL DEFAULT false,
  correlation_id   text NOT NULL,
  version          integer NOT NULL DEFAULT 0,
  opened_at        timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  closed_at        timestamptz
);
CREATE INDEX IF NOT EXISTS idx_cases_state ON recovery_cases(state);
CREATE INDEX IF NOT EXISTS idx_cases_merchant ON recovery_cases(merchant_id);
CREATE INDEX IF NOT EXISTS idx_cases_opened ON recovery_cases(opened_at DESC);

DROP TRIGGER IF EXISTS trg_cases_updated_at ON recovery_cases;
CREATE TRIGGER trg_cases_updated_at BEFORE UPDATE ON recovery_cases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- recovery_decisions ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS recovery_decisions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id              uuid NOT NULL REFERENCES recovery_cases(id) ON DELETE CASCADE,
  attempt              integer NOT NULL,
  source               text NOT NULL,
  action               text NOT NULL,
  reason               text NOT NULL,
  recovery_probability double precision NOT NULL,
  expected_value_paise bigint NOT NULL,
  confidence           double precision NOT NULL,
  factors              jsonb NOT NULL DEFAULT '[]'::jsonb,
  allowed_actions      jsonb NOT NULL DEFAULT '[]'::jsonb,
  policy_approved      boolean NOT NULL,
  policy_block_reason  text,
  model_version        text NOT NULL,
  policy_version       text NOT NULL,
  prompt_version       text NOT NULL,
  schema_version       text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_decisions_case ON recovery_decisions(case_id);

-- recovery_interventions ------------------------------------------------------
CREATE TABLE IF NOT EXISTS recovery_interventions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id            uuid NOT NULL REFERENCES recovery_cases(id) ON DELETE CASCADE,
  decision_id        uuid NOT NULL REFERENCES recovery_decisions(id) ON DELETE CASCADE,
  attempt            integer NOT NULL,
  type               text NOT NULL,
  status             text NOT NULL,
  provider_object_id text,
  short_url          text,
  reference_id       text UNIQUE,
  amount             bigint NOT NULL,
  expires_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  resolved_at        timestamptz
);
CREATE INDEX IF NOT EXISTS idx_interventions_case ON recovery_interventions(case_id);
CREATE INDEX IF NOT EXISTS idx_interventions_provider
  ON recovery_interventions(provider_object_id) WHERE provider_object_id IS NOT NULL;

-- audit_events ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id        uuid REFERENCES recovery_cases(id) ON DELETE CASCADE,
  correlation_id text NOT NULL,
  event          text NOT NULL,
  actor          text NOT NULL,
  detail         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_case ON audit_events(case_id);
CREATE INDEX IF NOT EXISTS idx_audit_correlation ON audit_events(correlation_id);

-- merchant_policies -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS merchant_policies (
  merchant_id                 uuid PRIMARY KEY REFERENCES merchants(id) ON DELETE CASCADE,
  version                     text NOT NULL,
  max_attempts                integer NOT NULL,
  min_value_paise             bigint NOT NULL,
  max_autonomous_value_paise  bigint NOT NULL,
  high_value_escalation_paise bigint NOT NULL,
  cooldown_minutes            integer NOT NULL,
  max_link_expiry_minutes     integer NOT NULL,
  daily_action_budget         integer NOT NULL,
  allowed_actions             jsonb NOT NULL,
  stop_on_suspicious          boolean NOT NULL,
  min_expected_value_paise    bigint NOT NULL,
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
