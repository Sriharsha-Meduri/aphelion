import { randomUUID } from 'node:crypto';
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
import type { UpsertPaymentInput } from '../../domain/types';

/**
 * In-memory implementation of every persistence port. It enforces the same
 * invariants the SQL schema does (unique provider ids, unique event id for
 * idempotency, no illegal payment downgrade), so tests and evaluation exercise
 * real behavior with no database.
 */
export function buildInMemoryRepositories(): Repositories {
  const merchants = new Map<string, Merchant>();
  const customers = new Map<string, Customer>();
  const customerByContact = new Map<string, string>(); // merchantId|contactHash -> id
  const payments = new Map<string, Payment>();
  const paymentByProvider = new Map<string, string>();
  const events = new Map<string, PaymentEvent>(); // providerEventId -> event
  const eventsById = new Map<string, PaymentEvent>();
  const cases = new Map<string, RecoveryCase>();
  const caseByPayment = new Map<string, string>();
  const decisions: RecoveryDecision[] = [];
  const interventions: RecoveryIntervention[] = [];
  const audits: AuditEvent[] = [];
  const policies = new Map<string, MerchantPolicy>();
  const now = () => new Date();

  return {
    merchants: {
      async getOrCreate(name) {
        for (const m of merchants.values()) if (m.name === name) return { ...m };
        const m: Merchant = { id: randomUUID(), name, createdAt: now() };
        merchants.set(m.id, m);
        return { ...m };
      },
      async getById(id) {
        const m = merchants.get(id);
        return m ? { ...m } : null;
      },
      async list() {
        return [...merchants.values()].map((m) => ({ ...m }));
      },
    },

    customers: {
      async upsertByContact(input: UpsertCustomerInput) {
        const key = `${input.merchantId}|${input.contactHash}`;
        const existingId = customerByContact.get(key);
        if (existingId) {
          const c = customers.get(existingId)!;
          c.lastSeenAt = now();
          return { customer: { ...c }, created: false };
        }
        const c: Customer = {
          id: randomUUID(),
          merchantId: input.merchantId,
          customerKey: input.customerKey,
          contactHash: input.contactHash,
          email: input.email,
          contact: input.contact,
          optedOut: false,
          priorSuccesses: 0,
          priorFailures: 0,
          priorRecoveries: 0,
          firstSeenAt: now(),
          lastSeenAt: now(),
        };
        customers.set(c.id, c);
        customerByContact.set(key, c.id);
        return { customer: { ...c }, created: true };
      },
      async getById(id) {
        const c = customers.get(id);
        return c ? { ...c } : null;
      },
      async setOptOut(id, optedOut) {
        const c = customers.get(id);
        if (c) c.optedOut = optedOut;
      },
      async applyCounters(id, delta) {
        const c = customers.get(id);
        if (!c) return;
        c.priorSuccesses += delta.successes ?? 0;
        c.priorFailures += delta.failures ?? 0;
        c.priorRecoveries += delta.recoveries ?? 0;
      },
    },

    payments: {
      async upsert(input: UpsertPaymentInput) {
        const existingId = paymentByProvider.get(input.providerPaymentId);
        if (existingId) {
          const p = payments.get(existingId)!;
          if (p.state === input.state) return { payment: { ...p }, created: false, transitioned: false };
          if (!canTransitionPayment(p.state, input.state)) {
            return { payment: { ...p }, created: false, transitioned: false }; // stale, ignore
          }
          p.state = input.state;
          p.failureCategory = input.failureCategory ?? p.failureCategory;
          p.errorCode = input.errorCode ?? p.errorCode;
          p.errorReason = input.errorReason ?? p.errorReason;
          p.errorSource = input.errorSource ?? p.errorSource;
          p.version += 1;
          p.updatedAt = now();
          return { payment: { ...p }, created: false, transitioned: true };
        }
        const p: Payment = {
          id: randomUUID(),
          merchantId: input.merchantId,
          customerId: input.customerId,
          providerPaymentId: input.providerPaymentId,
          orderId: input.orderId,
          amount: input.amount,
          currency: input.currency,
          method: input.method,
          state: input.state,
          failureCategory: input.failureCategory,
          errorCode: input.errorCode,
          errorReason: input.errorReason,
          errorSource: input.errorSource,
          description: input.description,
          version: 0,
          createdAt: now(),
          updatedAt: now(),
        };
        payments.set(p.id, p);
        paymentByProvider.set(p.providerPaymentId, p.id);
        return { payment: { ...p }, created: true, transitioned: true };
      },
      async getById(id) {
        const p = payments.get(id);
        return p ? { ...p } : null;
      },
      async getByProviderId(providerPaymentId) {
        const id = paymentByProvider.get(providerPaymentId);
        return id ? { ...payments.get(id)! } : null;
      },
    },

    paymentEvents: {
      async claim(input: NewPaymentEvent) {
        const existing = events.get(input.providerEventId);
        if (existing) return { event: { ...existing }, created: false };
        const e: PaymentEvent = {
          id: randomUUID(),
          providerEventId: input.providerEventId,
          eventType: input.eventType,
          providerPaymentId: input.providerPaymentId,
          payload: input.payload,
          status: 'received',
          errorText: null,
          receivedAt: now(),
          processedAt: null,
        };
        events.set(e.providerEventId, e);
        eventsById.set(e.id, e);
        return { event: { ...e }, created: true };
      },
      async markProcessed(id, status, errorText) {
        const e = eventsById.get(id);
        if (e) {
          e.status = status;
          e.errorText = errorText ?? null;
          e.processedAt = now();
        }
      },
      async findByProviderId(providerEventId) {
        const e = events.get(providerEventId);
        return e ? { ...e } : null;
      },
    },

    cases: {
      async create(input: NewCase) {
        const c: RecoveryCase = {
          id: randomUUID(),
          merchantId: input.merchantId,
          customerId: input.customerId,
          paymentId: input.paymentId,
          state: 'open',
          amountAtRisk: input.amountAtRisk,
          recoveredAmount: 0,
          attempts: 0,
          stopReason: null,
          escalated: false,
          correlationId: input.correlationId,
          version: 0,
          openedAt: now(),
          updatedAt: now(),
          closedAt: null,
        };
        cases.set(c.id, c);
        caseByPayment.set(c.paymentId, c.id);
        return { ...c };
      },
      async getById(id) {
        const c = cases.get(id);
        return c ? { ...c } : null;
      },
      async getByPaymentId(paymentId) {
        const id = caseByPayment.get(paymentId);
        return id ? { ...cases.get(id)! } : null;
      },
      async update(id, patch: CasePatch) {
        const c = cases.get(id)!;
        if (patch.state !== undefined) c.state = patch.state;
        if (patch.attempts !== undefined) c.attempts = patch.attempts;
        if (patch.recoveredAmount !== undefined) c.recoveredAmount = patch.recoveredAmount;
        if (patch.stopReason !== undefined) c.stopReason = patch.stopReason;
        if (patch.escalated !== undefined) c.escalated = patch.escalated;
        if (patch.closedAt !== undefined) c.closedAt = patch.closedAt;
        c.version += 1;
        c.updatedAt = now();
        return { ...c };
      },
      async list(filter: CaseFilter) {
        let arr = [...cases.values()];
        if (filter.merchantId) arr = arr.filter((c) => c.merchantId === filter.merchantId);
        if (filter.state) arr = arr.filter((c) => c.state === filter.state);
        arr.sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime());
        if (filter.limit && filter.limit > 0) arr = arr.slice(0, filter.limit);
        return arr.map((c) => ({ ...c }));
      },
    },

    decisions: {
      async insert(input: NewDecision) {
        const d: RecoveryDecision = { id: randomUUID(), createdAt: now(), ...input };
        decisions.push(d);
        return { ...d };
      },
      async listByCase(caseId) {
        return decisions.filter((d) => d.caseId === caseId).map((d) => ({ ...d }));
      },
    },

    interventions: {
      async insert(input: NewIntervention) {
        const i: RecoveryIntervention = { id: randomUUID(), createdAt: now(), resolvedAt: null, ...input };
        interventions.push(i);
        return { ...i };
      },
      async updateStatus(id, status, resolvedAt) {
        const i = interventions.find((x) => x.id === id);
        if (i) {
          i.status = status;
          if (resolvedAt !== undefined) i.resolvedAt = resolvedAt;
        }
      },
      async getByCase(caseId) {
        return interventions.filter((i) => i.caseId === caseId).map((i) => ({ ...i }));
      },
      async findByReferenceId(referenceId) {
        const i = interventions.find((x) => x.referenceId === referenceId);
        return i ? { ...i } : null;
      },
      async findByProviderObjectId(providerObjectId) {
        const i = interventions.find((x) => x.providerObjectId === providerObjectId);
        return i ? { ...i } : null;
      },
      async countActionsSince(merchantId, since) {
        const merchantCases = new Set([...cases.values()].filter((c) => c.merchantId === merchantId).map((c) => c.id));
        return interventions.filter((i) => merchantCases.has(i.caseId) && i.createdAt >= since && i.type === 'PAYMENT_LINK')
          .length;
      },
      async lastAttemptAt(caseId) {
        const list = interventions.filter((i) => i.caseId === caseId);
        if (list.length === 0) return null;
        return list.reduce((max, i) => (i.createdAt > max ? i.createdAt : max), list[0].createdAt);
      },
    },

    audit: {
      async insert(input: NewAudit) {
        const a: AuditEvent = { id: randomUUID(), createdAt: now(), ...input };
        audits.push(a);
        return { ...a };
      },
      async listByCase(caseId) {
        return audits
          .filter((a) => a.caseId === caseId)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map((a) => ({ ...a }));
      },
    },

    policies: {
      async getForMerchant(merchantId) {
        const p = policies.get(merchantId);
        return p ? { ...p } : null;
      },
      async upsert(policy) {
        policies.set(policy.merchantId, { ...policy, updatedAt: new Date() });
        return { ...policies.get(policy.merchantId)! };
      },
    },

    async ping() {
      /* always healthy */
    },
    async close() {
      /* nothing to release */
    },
  };
}
