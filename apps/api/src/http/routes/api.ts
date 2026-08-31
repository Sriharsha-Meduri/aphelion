import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Container } from '../../container';
import type { RecoveryCase } from '../../domain/types';
import { DEFAULT_MERCHANT_NAME } from '../../pipeline/recovery-pipeline';
import { defaultPolicy } from '../../policy/defaults';
import { computeStats } from '../../services/stats';
import { redactContact } from '../../util/redact';
import { recoveryReferenceId } from '../../util/ids';
import { Events } from '../../observability/events';
import { correlationId as newCorrelationId } from '../../util/ids';
import { NotFoundError, ValidationError, toErrorInfo } from '../../util/errors';

export function registerApiRoutes(app: FastifyInstance, container: Container): void {
  const { repos, razorpay, logger } = container;

  const merchant = async () => repos.merchants.getOrCreate(DEFAULT_MERCHANT_NAME);

  async function summarize(c: RecoveryCase) {
    const payment = await repos.payments.getById(c.paymentId);
    const customer = await repos.customers.getById(c.customerId);
    const decisions = await repos.decisions.listByCase(c.id);
    const latest = decisions[decisions.length - 1];
    return {
      id: c.id,
      state: c.state,
      amountAtRisk: c.amountAtRisk,
      recoveredAmount: c.recoveredAmount,
      attempts: c.attempts,
      escalated: c.escalated,
      stopReason: c.stopReason,
      openedAt: c.openedAt,
      updatedAt: c.updatedAt,
      customerKey: customer?.customerKey ?? null,
      method: payment?.method ?? null,
      failureCategory: payment?.failureCategory ?? null,
      providerPaymentId: payment?.providerPaymentId ?? null,
      latestAction: latest?.action ?? null,
      source: latest?.source ?? null,
      recoveryProbability: latest?.recoveryProbability ?? null,
      expectedValuePaise: latest?.expectedValuePaise ?? null,
    };
  }

  app.get('/api/overview', async () => {
    const m = await merchant();
    const stats = await computeStats(repos, m.id);
    const recent = await repos.cases.list({ merchantId: m.id, limit: 8 });
    return { merchant: { id: m.id, name: m.name }, stats, recentCases: await Promise.all(recent.map(summarize)) };
  });

  app.get('/api/cases', async (req: FastifyRequest) => {
    const m = await merchant();
    const q = req.query as { state?: string; limit?: string };
    const cases = await repos.cases.list({
      merchantId: m.id,
      state: q.state as RecoveryCase['state'] | undefined,
      limit: q.limit ? Number(q.limit) : 100,
    });
    return { cases: await Promise.all(cases.map(summarize)) };
  });

  app.get('/api/cases/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const c = await repos.cases.getById(id);
    if (!c) return reply.code(404).send({ error: 'not_found' });
    const payment = await repos.payments.getById(c.paymentId);
    const customer = await repos.customers.getById(c.customerId);
    const decisions = await repos.decisions.listByCase(id);
    const interventions = await repos.interventions.getByCase(id);
    const audit = await repos.audit.listByCase(id);
    return {
      case: c,
      payment,
      customer: customer
        ? {
            customerKey: customer.customerKey,
            email: redactContact(customer.email),
            contact: redactContact(customer.contact),
            optedOut: customer.optedOut,
            priorSuccesses: customer.priorSuccesses,
            priorFailures: customer.priorFailures,
            priorRecoveries: customer.priorRecoveries,
          }
        : null,
      decisions,
      interventions,
      audit,
    };
  });

  app.get('/api/policy', async () => {
    const m = await merchant();
    const stored = await repos.policies.getForMerchant(m.id);
    return { policy: stored ?? defaultPolicy(m.id) };
  });

  const PolicyPatch = z.object({
    maxAttempts: z.number().int().min(0).max(10).optional(),
    minValuePaise: z.number().int().min(0).optional(),
    maxAutonomousValuePaise: z.number().int().min(0).optional(),
    highValueEscalationPaise: z.number().int().min(0).optional(),
    cooldownMinutes: z.number().int().min(0).optional(),
    dailyActionBudget: z.number().int().min(0).optional(),
    stopOnSuspicious: z.boolean().optional(),
    minExpectedValuePaise: z.number().int().optional(),
  });

  app.put('/api/policy', async (req: FastifyRequest) => {
    const m = await merchant();
    const parsed = PolicyPatch.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid policy patch');
    const current = (await repos.policies.getForMerchant(m.id)) ?? defaultPolicy(m.id);
    const next = { ...current, ...parsed.data, updatedAt: new Date() };
    const saved = await repos.policies.upsert(next);
    return { policy: saved };
  });

  const OverrideBody = z.object({ action: z.enum(['approve', 'stop', 'escalate']) });

  app.post('/api/cases/:id/override', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const parsed = OverrideBody.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid override action');
    const c = await repos.cases.getById(id);
    if (!c) throw new NotFoundError('Case not found');
    if (c.state === 'recovered') return reply.code(409).send({ error: 'already_recovered' });

    const correlationId = c.correlationId || newCorrelationId();
    const action = parsed.data.action;

    if (action === 'stop') {
      await repos.cases.update(id, { state: 'stopped', closedAt: new Date() });
      await repos.audit.insert({ caseId: id, correlationId, event: Events.MANUAL_OVERRIDE, actor: 'operator', detail: { action: 'stop' } });
      await repos.audit.insert({ caseId: id, correlationId, event: Events.CASE_STOPPED, actor: 'operator', detail: { reason: 'operator_stop' } });
      return { ok: true, state: 'stopped' };
    }
    if (action === 'escalate') {
      await repos.cases.update(id, { state: 'escalated', escalated: true });
      await repos.audit.insert({ caseId: id, correlationId, event: Events.MANUAL_OVERRIDE, actor: 'operator', detail: { action: 'escalate' } });
      return { ok: true, state: 'escalated' };
    }

    // approve: create a recovery payment link tied to the latest decision.
    const decisions = await repos.decisions.listByCase(id);
    const latest = decisions[decisions.length - 1];
    if (!latest) return reply.code(409).send({ error: 'no_decision' });
    const attempt = c.attempts + 1;
    const referenceId = recoveryReferenceId(id, attempt);
    try {
      const link = await razorpay.createPaymentLink({
        amount: c.amountAtRisk,
        currency: 'INR',
        referenceId,
        description: `Operator approved recovery for case ${id}`,
        customer: { email: null, contact: null },
        notes: { case_id: id, reference_id: referenceId, operator: 'true' },
      });
      await repos.interventions.insert({
        caseId: id,
        decisionId: latest.id,
        attempt,
        type: 'PAYMENT_LINK',
        status: 'created',
        providerObjectId: link.id,
        shortUrl: link.shortUrl,
        referenceId,
        amount: c.amountAtRisk,
        expiresAt: null,
      });
      await repos.cases.update(id, { state: 'link_created', attempts: attempt });
      await repos.audit.insert({ caseId: id, correlationId, event: Events.MANUAL_OVERRIDE, actor: 'operator', detail: { action: 'approve' } });
      await repos.audit.insert({ caseId: id, correlationId, event: Events.LINK_CREATED, actor: 'operator', detail: { linkId: link.id, shortUrl: link.shortUrl } });
      return { ok: true, state: 'link_created', shortUrl: link.shortUrl };
    } catch (err) {
      logger.error({ event: Events.ACTION_FAILED, err: toErrorInfo(err) }, 'operator approve failed');
      return reply.code(502).send({ error: 'link_failed' });
    }
  });

  app.get('/api/model', async () => {
    if (!container.model) return { version: 'heuristic-prior-v1', trained: false };
    const m = container.model;
    return { version: m.version, trained: true, trainedAt: m.trainedAt, seed: m.seed, metrics: m.metrics ?? {}, featureNames: m.featureNames };
  });

  app.get('/api/evaluation', async () => {
    try {
      const path = resolve(process.cwd(), 'data', 'evaluation.json');
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      return { status: 'not_run', hint: 'Run npm run eval to generate held-out evaluation results.' };
    }
  });
}
