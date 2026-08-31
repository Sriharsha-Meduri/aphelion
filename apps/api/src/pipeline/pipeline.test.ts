import { describe, it, expect, beforeEach } from 'vitest';
import { testContainer, makeTestConfig, silentLogger } from '../test/helpers';
import type { Container } from '../container';
import type { InboundEvent, NormalizedPayment } from '../razorpay';
import { createRecoveryPipeline } from './recovery-pipeline';
import { createRecoveryAgent } from '../ai/agent';
import { correlationId } from '../util/ids';

let seq = 0;
function ppid(): string {
  seq += 1;
  return `pay_test_${seq}`;
}

function failedEvent(id: string, opts: { amount?: number; reason?: string; source?: string; contact?: string } = {}): InboundEvent {
  const payment: NormalizedPayment = {
    id,
    orderId: `order_${id}`,
    amount: opts.amount ?? 200000,
    currency: 'INR',
    status: 'failed',
    method: 'card',
    email: 'buyer@example.test',
    contact: opts.contact ?? '+919812345678',
    errorCode: 'GATEWAY_ERROR',
    errorReason: opts.reason ?? 'card_declined_by_issuer',
    errorSource: opts.source ?? 'bank',
    errorStep: 'payment_authorization',
    description: null,
    referenceId: null,
  };
  return { providerEventId: `evt_${id}`, eventType: 'payment.failed', createdAt: Math.floor(Date.now() / 1000), payment, paymentLink: null, raw: {} };
}

function linkPaidEvent(referenceId: string, amount: number): InboundEvent {
  return {
    providerEventId: `evt_paid_${referenceId}`,
    eventType: 'payment_link.paid',
    createdAt: Math.floor(Date.now() / 1000),
    payment: null,
    paymentLink: { id: `plink_${referenceId}`, status: 'paid', amount, amountPaid: amount, referenceId },
    raw: {},
  };
}

function capturedEvent(id: string, amount: number): InboundEvent {
  return {
    providerEventId: `evt_cap_${id}`,
    eventType: 'payment.captured',
    createdAt: Math.floor(Date.now() / 1000),
    payment: { id, orderId: null, amount, currency: 'INR', status: 'captured', method: 'card', email: null, contact: null, errorCode: null, errorReason: null, errorSource: null, errorStep: null, description: null, referenceId: null },
    paymentLink: null,
    raw: {},
  };
}

async function caseFor(container: Container, id: string) {
  const payment = await container.repos.payments.getByProviderId(id);
  if (!payment) return null;
  return container.repos.cases.getByPaymentId(payment.id);
}

describe('recovery pipeline', () => {
  let container: Container;
  beforeEach(() => {
    container = testContainer();
  });

  it('runs the full loop: failed payment to a created link to a confirmed recovery', async () => {
    const id = ppid();
    await container.pipeline.processEvent(failedEvent(id, { amount: 250000 }), correlationId());
    const kase = (await caseFor(container, id))!;
    expect(kase.state).toBe('link_created');

    const interventions = await container.repos.interventions.getByCase(kase.id);
    const link = interventions.find((iv) => iv.type === 'PAYMENT_LINK');
    expect(link?.shortUrl).toContain('rzp.io');

    await container.pipeline.processEvent(linkPaidEvent(link!.referenceId!, 250000), correlationId());
    const recovered = await container.repos.cases.getById(kase.id);
    expect(recovered?.state).toBe('recovered');
    expect(recovered?.recoveredAmount).toBe(250000);
  });

  it('is idempotent: the same failed payment does not create two cases', async () => {
    const id = ppid();
    const event = failedEvent(id);
    await container.pipeline.processEvent(event, correlationId());
    await container.pipeline.processEvent(event, correlationId());
    const all = await container.repos.cases.list({ limit: 100 });
    expect(all.filter((c) => c.paymentId)).toHaveLength(1);
  });

  it('does not attempt recovery when a capture arrived before a stale failure', async () => {
    const id = ppid();
    await container.pipeline.processEvent(capturedEvent(id, 200000), correlationId());
    await container.pipeline.processEvent(failedEvent(id), correlationId());
    const payment = await container.repos.payments.getByProviderId(id);
    expect(payment?.state).toBe('captured');
    const kase = (await caseFor(container, id))!;
    expect(['stopped', 'no_action']).toContain(kase.state);
  });

  it('escalates a high value failed payment', async () => {
    const id = ppid();
    await container.pipeline.processEvent(failedEvent(id, { amount: 3000000 }), correlationId());
    const kase = (await caseFor(container, id))!;
    expect(kase.state).toBe('escalated');
    expect(kase.escalated).toBe(true);
  });

  it('stops recovery for a suspicious failure', async () => {
    const id = ppid();
    await container.pipeline.processEvent(failedEvent(id, { reason: 'payment_failed_risk_check', source: 'razorpay' }), correlationId());
    const kase = (await caseFor(container, id))!;
    expect(kase.state).toBe('stopped');
    expect(kase.stopReason).toBe('suspicious');
  });

  it('stops recovery for an opted-out customer', async () => {
    const contact = '+919800000001';
    const first = ppid();
    await container.pipeline.processEvent(failedEvent(first, { contact }), correlationId());
    const firstCase = (await caseFor(container, first))!;
    await container.repos.customers.setOptOut(firstCase.customerId, true);

    const second = ppid();
    await container.pipeline.processEvent(failedEvent(second, { contact }), correlationId());
    const secondCase = (await caseFor(container, second))!;
    expect(secondCase.state).toBe('stopped');
    expect(secondCase.stopReason).toBe('customer_opt_out');
  });

  it('keeps working when the model is unavailable (deterministic fallback still acts safely)', async () => {
    const cfg = makeTestConfig();
    const logger = silentLogger();
    const down = { name: 'down', async generate() { throw new Error('model down'); } };
    const agent = createRecoveryAgent(cfg, down);
    const pipeline = createRecoveryPipeline({
      config: cfg,
      repos: container.repos,
      razorpay: container.razorpay,
      agent,
      model: null,
      logger,
    });
    const id = ppid();
    await pipeline.processEvent(failedEvent(id, { amount: 250000 }), correlationId());
    const kase = (await caseFor(container, id))!;
    expect(kase.state).toBe('link_created');
    const decisions = await container.repos.decisions.listByCase(kase.id);
    expect(decisions[0].source).toBe('fallback');
  });

  it('attributes a recovery only once (idempotent paid event)', async () => {
    const id = ppid();
    await container.pipeline.processEvent(failedEvent(id, { amount: 100000 }), correlationId());
    const kase = (await caseFor(container, id))!;
    const link = (await container.repos.interventions.getByCase(kase.id)).find((iv) => iv.type === 'PAYMENT_LINK')!;
    await container.pipeline.processEvent(linkPaidEvent(link.referenceId!, 100000), correlationId());
    await container.pipeline.processEvent(linkPaidEvent(link.referenceId!, 100000), correlationId());
    const recovered = await container.repos.cases.getById(kase.id);
    expect(recovered?.recoveredAmount).toBe(100000);
  });
});
