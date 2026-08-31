import type { Pool } from 'pg';
import type {
  AuditEvent,
  Customer,
  Merchant,
  MerchantPolicy,
  Payment,
  PaymentEvent,
  RecoveryCase,
  RecoveryDecision,
  RecoveryIntervention,
  UpsertPaymentInput,
} from '../../domain/types';
import { canTransitionPayment } from '../../domain/payment-state';
import type {
  CaseFilter,
  CasePatch,
  NewAudit,
  NewCase,
  NewDecision,
  NewIntervention,
  NewPaymentEvent,
  Repositories,
  UpsertCustomerInput,
} from '../types';

/* eslint-disable @typescript-eslint/no-explicit-any */
const j = (v: unknown) => JSON.stringify(v ?? null);

const mapMerchant = (r: any): Merchant => ({ id: r.id, name: r.name, createdAt: r.created_at });
const mapCustomer = (r: any): Customer => ({
  id: r.id,
  merchantId: r.merchant_id,
  customerKey: r.customer_key,
  contactHash: r.contact_hash,
  email: r.email,
  contact: r.contact,
  optedOut: r.opted_out,
  priorSuccesses: r.prior_successes,
  priorFailures: r.prior_failures,
  priorRecoveries: r.prior_recoveries,
  firstSeenAt: r.first_seen_at,
  lastSeenAt: r.last_seen_at,
});
const mapPayment = (r: any): Payment => ({
  id: r.id,
  merchantId: r.merchant_id,
  customerId: r.customer_id,
  providerPaymentId: r.provider_payment_id,
  orderId: r.order_id,
  amount: Number(r.amount),
  currency: r.currency,
  method: r.method,
  state: r.state,
  failureCategory: r.failure_category,
  errorCode: r.error_code,
  errorReason: r.error_reason,
  errorSource: r.error_source,
  description: r.description,
  version: r.version,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const mapEvent = (r: any): PaymentEvent => ({
  id: r.id,
  providerEventId: r.provider_event_id,
  eventType: r.event_type,
  providerPaymentId: r.provider_payment_id,
  payload: r.payload ?? {},
  status: r.status,
  errorText: r.error_text,
  receivedAt: r.received_at,
  processedAt: r.processed_at,
});
const mapCase = (r: any): RecoveryCase => ({
  id: r.id,
  merchantId: r.merchant_id,
  customerId: r.customer_id,
  paymentId: r.payment_id,
  state: r.state,
  amountAtRisk: Number(r.amount_at_risk),
  recoveredAmount: Number(r.recovered_amount),
  attempts: r.attempts,
  stopReason: r.stop_reason,
  escalated: r.escalated,
  correlationId: r.correlation_id,
  version: r.version,
  openedAt: r.opened_at,
  updatedAt: r.updated_at,
  closedAt: r.closed_at,
});
const mapDecision = (r: any): RecoveryDecision => ({
  id: r.id,
  caseId: r.case_id,
  attempt: r.attempt,
  source: r.source,
  action: r.action,
  reason: r.reason,
  recoveryProbability: r.recovery_probability,
  expectedValuePaise: Number(r.expected_value_paise),
  confidence: r.confidence,
  factors: r.factors ?? [],
  allowedActions: r.allowed_actions ?? [],
  policyApproved: r.policy_approved,
  policyBlockReason: r.policy_block_reason,
  modelVersion: r.model_version,
  policyVersion: r.policy_version,
  promptVersion: r.prompt_version,
  schemaVersion: r.schema_version,
  createdAt: r.created_at,
});
const mapIntervention = (r: any): RecoveryIntervention => ({
  id: r.id,
  caseId: r.case_id,
  decisionId: r.decision_id,
  attempt: r.attempt,
  type: r.type,
  status: r.status,
  providerObjectId: r.provider_object_id,
  shortUrl: r.short_url,
  referenceId: r.reference_id,
  amount: Number(r.amount),
  expiresAt: r.expires_at,
  createdAt: r.created_at,
  resolvedAt: r.resolved_at,
});
const mapAudit = (r: any): AuditEvent => ({
  id: r.id,
  caseId: r.case_id,
  correlationId: r.correlation_id,
  event: r.event,
  actor: r.actor,
  detail: r.detail ?? {},
  createdAt: r.created_at,
});
const mapPolicy = (r: any): MerchantPolicy => ({
  merchantId: r.merchant_id,
  version: r.version,
  maxAttempts: r.max_attempts,
  minValuePaise: Number(r.min_value_paise),
  maxAutonomousValuePaise: Number(r.max_autonomous_value_paise),
  highValueEscalationPaise: Number(r.high_value_escalation_paise),
  cooldownMinutes: r.cooldown_minutes,
  maxLinkExpiryMinutes: r.max_link_expiry_minutes,
  dailyActionBudget: r.daily_action_budget,
  allowedActions: r.allowed_actions ?? [],
  stopOnSuspicious: r.stop_on_suspicious,
  minExpectedValuePaise: Number(r.min_expected_value_paise),
  updatedAt: r.updated_at,
});

export function buildPgRepositories(pool: Pool): Repositories {
  return {
    merchants: {
      async getOrCreate(name) {
        const found = await pool.query('SELECT * FROM merchants WHERE name = $1 LIMIT 1', [name]);
        if (found.rows[0]) return mapMerchant(found.rows[0]);
        const ins = await pool.query('INSERT INTO merchants(name) VALUES ($1) RETURNING *', [name]);
        return mapMerchant(ins.rows[0]);
      },
      async getById(id) {
        const r = await pool.query('SELECT * FROM merchants WHERE id = $1', [id]);
        return r.rows[0] ? mapMerchant(r.rows[0]) : null;
      },
      async list() {
        const r = await pool.query('SELECT * FROM merchants ORDER BY created_at');
        return r.rows.map(mapMerchant);
      },
    },

    customers: {
      async upsertByContact(input: UpsertCustomerInput) {
        const ins = await pool.query(
          `INSERT INTO customers(merchant_id, customer_key, contact_hash, email, contact)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (merchant_id, contact_hash) DO NOTHING RETURNING *`,
          [input.merchantId, input.customerKey, input.contactHash, input.email, input.contact],
        );
        if (ins.rows[0]) return { customer: mapCustomer(ins.rows[0]), created: true };
        const ex = await pool.query(
          `UPDATE customers SET last_seen_at = now() WHERE merchant_id = $1 AND contact_hash = $2 RETURNING *`,
          [input.merchantId, input.contactHash],
        );
        return { customer: mapCustomer(ex.rows[0]), created: false };
      },
      async getById(id) {
        const r = await pool.query('SELECT * FROM customers WHERE id = $1', [id]);
        return r.rows[0] ? mapCustomer(r.rows[0]) : null;
      },
      async setOptOut(id, optedOut) {
        await pool.query('UPDATE customers SET opted_out = $2 WHERE id = $1', [id, optedOut]);
      },
      async applyCounters(id, delta) {
        await pool.query(
          `UPDATE customers SET prior_successes = prior_successes + $2,
             prior_failures = prior_failures + $3, prior_recoveries = prior_recoveries + $4 WHERE id = $1`,
          [id, delta.successes ?? 0, delta.failures ?? 0, delta.recoveries ?? 0],
        );
      },
    },

    payments: {
      async upsert(input: UpsertPaymentInput) {
        const ins = await pool.query(
          `INSERT INTO payments(merchant_id, customer_id, provider_payment_id, order_id, amount, currency, method,
             state, failure_category, error_code, error_reason, error_source, description)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (provider_payment_id) DO NOTHING RETURNING *`,
          [
            input.merchantId, input.customerId, input.providerPaymentId, input.orderId, input.amount, input.currency,
            input.method, input.state, input.failureCategory, input.errorCode, input.errorReason, input.errorSource,
            input.description,
          ],
        );
        if (ins.rows[0]) return { payment: mapPayment(ins.rows[0]), created: true, transitioned: true };
        const cur = await pool.query('SELECT * FROM payments WHERE provider_payment_id = $1', [input.providerPaymentId]);
        const existing = mapPayment(cur.rows[0]);
        if (existing.state === input.state) return { payment: existing, created: false, transitioned: false };
        if (!canTransitionPayment(existing.state, input.state)) {
          return { payment: existing, created: false, transitioned: false };
        }
        const upd = await pool.query(
          `UPDATE payments SET state = $2, failure_category = COALESCE($3, failure_category),
             error_code = COALESCE($4, error_code), error_reason = COALESCE($5, error_reason),
             error_source = COALESCE($6, error_source), version = version + 1
           WHERE provider_payment_id = $1 AND state = $7 RETURNING *`,
          [input.providerPaymentId, input.state, input.failureCategory, input.errorCode, input.errorReason, input.errorSource, existing.state],
        );
        if (!upd.rows[0]) return { payment: existing, created: false, transitioned: false };
        return { payment: mapPayment(upd.rows[0]), created: false, transitioned: true };
      },
      async getById(id) {
        const r = await pool.query('SELECT * FROM payments WHERE id = $1', [id]);
        return r.rows[0] ? mapPayment(r.rows[0]) : null;
      },
      async getByProviderId(providerPaymentId) {
        const r = await pool.query('SELECT * FROM payments WHERE provider_payment_id = $1', [providerPaymentId]);
        return r.rows[0] ? mapPayment(r.rows[0]) : null;
      },
    },

    paymentEvents: {
      async claim(input: NewPaymentEvent) {
        const ins = await pool.query(
          `INSERT INTO payment_events(provider_event_id, event_type, provider_payment_id, payload)
           VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (provider_event_id) DO NOTHING RETURNING *`,
          [input.providerEventId, input.eventType, input.providerPaymentId, j(input.payload)],
        );
        if (ins.rows[0]) return { event: mapEvent(ins.rows[0]), created: true };
        const ex = await pool.query('SELECT * FROM payment_events WHERE provider_event_id = $1', [input.providerEventId]);
        return { event: mapEvent(ex.rows[0]), created: false };
      },
      async markProcessed(id, status, errorText) {
        await pool.query('UPDATE payment_events SET status = $2, error_text = $3, processed_at = now() WHERE id = $1', [
          id, status, errorText ?? null,
        ]);
      },
      async findByProviderId(providerEventId) {
        const r = await pool.query('SELECT * FROM payment_events WHERE provider_event_id = $1', [providerEventId]);
        return r.rows[0] ? mapEvent(r.rows[0]) : null;
      },
    },

    cases: {
      async create(input: NewCase) {
        const r = await pool.query(
          `INSERT INTO recovery_cases(merchant_id, customer_id, payment_id, state, amount_at_risk, correlation_id)
           VALUES ($1,$2,$3,'open',$4,$5) RETURNING *`,
          [input.merchantId, input.customerId, input.paymentId, input.amountAtRisk, input.correlationId],
        );
        return mapCase(r.rows[0]);
      },
      async getById(id) {
        const r = await pool.query('SELECT * FROM recovery_cases WHERE id = $1', [id]);
        return r.rows[0] ? mapCase(r.rows[0]) : null;
      },
      async getByPaymentId(paymentId) {
        const r = await pool.query('SELECT * FROM recovery_cases WHERE payment_id = $1', [paymentId]);
        return r.rows[0] ? mapCase(r.rows[0]) : null;
      },
      async update(id, patch: CasePatch) {
        const r = await pool.query(
          `UPDATE recovery_cases SET
             state = COALESCE($2, state), attempts = COALESCE($3, attempts),
             recovered_amount = COALESCE($4, recovered_amount), stop_reason = $5,
             escalated = COALESCE($6, escalated), closed_at = $7, version = version + 1
           WHERE id = $1 RETURNING *`,
          [
            id, patch.state ?? null, patch.attempts ?? null, patch.recoveredAmount ?? null,
            patch.stopReason === undefined ? null : patch.stopReason, patch.escalated ?? null,
            patch.closedAt === undefined ? null : patch.closedAt,
          ],
        );
        return mapCase(r.rows[0]);
      },
      async list(filter: CaseFilter) {
        const where: string[] = [];
        const params: unknown[] = [];
        if (filter.merchantId) {
          params.push(filter.merchantId);
          where.push(`merchant_id = $${params.length}`);
        }
        if (filter.state) {
          params.push(filter.state);
          where.push(`state = $${params.length}`);
        }
        params.push(filter.limit && filter.limit > 0 ? filter.limit : 200);
        const r = await pool.query(
          `SELECT * FROM recovery_cases ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
           ORDER BY opened_at DESC LIMIT $${params.length}`,
          params,
        );
        return r.rows.map(mapCase);
      },
    },

    decisions: {
      async insert(input: NewDecision) {
        const r = await pool.query(
          `INSERT INTO recovery_decisions(case_id, attempt, source, action, reason, recovery_probability,
             expected_value_paise, confidence, factors, allowed_actions, policy_approved, policy_block_reason,
             model_version, policy_version, prompt_version, schema_version)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15,$16) RETURNING *`,
          [
            input.caseId, input.attempt, input.source, input.action, input.reason, input.recoveryProbability,
            input.expectedValuePaise, input.confidence, j(input.factors), j(input.allowedActions), input.policyApproved,
            input.policyBlockReason, input.modelVersion, input.policyVersion, input.promptVersion, input.schemaVersion,
          ],
        );
        return mapDecision(r.rows[0]);
      },
      async listByCase(caseId) {
        const r = await pool.query('SELECT * FROM recovery_decisions WHERE case_id = $1 ORDER BY created_at', [caseId]);
        return r.rows.map(mapDecision);
      },
    },

    interventions: {
      async insert(input: NewIntervention) {
        const r = await pool.query(
          `INSERT INTO recovery_interventions(case_id, decision_id, attempt, type, status, provider_object_id,
             short_url, reference_id, amount, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [
            input.caseId, input.decisionId, input.attempt, input.type, input.status, input.providerObjectId,
            input.shortUrl, input.referenceId, input.amount, input.expiresAt,
          ],
        );
        return mapIntervention(r.rows[0]);
      },
      async updateStatus(id, status, resolvedAt) {
        await pool.query('UPDATE recovery_interventions SET status = $2, resolved_at = $3 WHERE id = $1', [
          id, status, resolvedAt ?? null,
        ]);
      },
      async getByCase(caseId) {
        const r = await pool.query('SELECT * FROM recovery_interventions WHERE case_id = $1 ORDER BY created_at', [caseId]);
        return r.rows.map(mapIntervention);
      },
      async findByReferenceId(referenceId) {
        const r = await pool.query('SELECT * FROM recovery_interventions WHERE reference_id = $1', [referenceId]);
        return r.rows[0] ? mapIntervention(r.rows[0]) : null;
      },
      async findByProviderObjectId(providerObjectId) {
        const r = await pool.query('SELECT * FROM recovery_interventions WHERE provider_object_id = $1 LIMIT 1', [providerObjectId]);
        return r.rows[0] ? mapIntervention(r.rows[0]) : null;
      },
      async countActionsSince(merchantId, since) {
        const r = await pool.query(
          `SELECT count(*)::int AS n FROM recovery_interventions i
             JOIN recovery_cases c ON c.id = i.case_id
           WHERE c.merchant_id = $1 AND i.created_at >= $2 AND i.type = 'PAYMENT_LINK'`,
          [merchantId, since],
        );
        return r.rows[0].n;
      },
      async lastAttemptAt(caseId) {
        const r = await pool.query('SELECT max(created_at) AS ts FROM recovery_interventions WHERE case_id = $1', [caseId]);
        return r.rows[0].ts ?? null;
      },
    },

    audit: {
      async insert(input: NewAudit) {
        const r = await pool.query(
          `INSERT INTO audit_events(case_id, correlation_id, event, actor, detail)
           VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING *`,
          [input.caseId, input.correlationId, input.event, input.actor, j(input.detail)],
        );
        return mapAudit(r.rows[0]);
      },
      async listByCase(caseId) {
        const r = await pool.query('SELECT * FROM audit_events WHERE case_id = $1 ORDER BY created_at', [caseId]);
        return r.rows.map(mapAudit);
      },
    },

    policies: {
      async getForMerchant(merchantId) {
        const r = await pool.query('SELECT * FROM merchant_policies WHERE merchant_id = $1', [merchantId]);
        return r.rows[0] ? mapPolicy(r.rows[0]) : null;
      },
      async upsert(p) {
        const r = await pool.query(
          `INSERT INTO merchant_policies(merchant_id, version, max_attempts, min_value_paise, max_autonomous_value_paise,
             high_value_escalation_paise, cooldown_minutes, max_link_expiry_minutes, daily_action_budget, allowed_actions,
             stop_on_suspicious, min_expected_value_paise)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)
           ON CONFLICT (merchant_id) DO UPDATE SET version = EXCLUDED.version, max_attempts = EXCLUDED.max_attempts,
             min_value_paise = EXCLUDED.min_value_paise, max_autonomous_value_paise = EXCLUDED.max_autonomous_value_paise,
             high_value_escalation_paise = EXCLUDED.high_value_escalation_paise, cooldown_minutes = EXCLUDED.cooldown_minutes,
             max_link_expiry_minutes = EXCLUDED.max_link_expiry_minutes, daily_action_budget = EXCLUDED.daily_action_budget,
             allowed_actions = EXCLUDED.allowed_actions, stop_on_suspicious = EXCLUDED.stop_on_suspicious,
             min_expected_value_paise = EXCLUDED.min_expected_value_paise, updated_at = now()
           RETURNING *`,
          [
            p.merchantId, p.version, p.maxAttempts, p.minValuePaise, p.maxAutonomousValuePaise, p.highValueEscalationPaise,
            p.cooldownMinutes, p.maxLinkExpiryMinutes, p.dailyActionBudget, j(p.allowedActions), p.stopOnSuspicious,
            p.minExpectedValuePaise,
          ],
        );
        return mapPolicy(r.rows[0]);
      },
    },

    async ping() {
      await pool.query('SELECT 1');
    },
    async close() {
      await pool.end();
    },
  };
}
