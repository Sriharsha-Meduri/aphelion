import { createHash } from 'node:crypto';
import type { AppConfig } from '../config/env';
import type { Logger } from '../observability/logger';
import { Events } from '../observability/events';
import type { Repositories } from '../repositories/types';
import type { RazorpayClient, InboundEvent } from '../razorpay';
import type { RecoveryAgent } from '../ai/agent';
import type { RecoveryModel } from '../recovery/model';
import type { CaseContext } from '../domain/context';
import type { ActionType, MerchantPolicy, Payment, RecoveryCase, StopReason } from '../domain/types';
import { classifyFailure } from '../diagnosis/failure-classifier';
import { signalsToFactors } from '../diagnosis/signals';
import { assessCase, type RecoveryAssessment } from '../recovery/decide';
import { evaluatePolicy } from '../policy/engine';
import { defaultPolicy } from '../policy/defaults';
import { buildCaseContext } from './context-builder';
import { customerKey, redactContact } from '../util/redact';
import { recoveryReferenceId } from '../util/ids';
import { toErrorInfo } from '../util/errors';

export const DEFAULT_MERCHANT_NAME = 'Aphelion Demo Store';

export interface PipelineDeps {
  config: AppConfig;
  repos: Repositories;
  razorpay: RazorpayClient;
  agent: RecoveryAgent;
  model: RecoveryModel | null;
  logger: Logger;
}

export interface RecoveryPipeline {
  processEvent(event: InboundEvent, correlationId: string): Promise<void>;
}

export function createRecoveryPipeline(deps: PipelineDeps): RecoveryPipeline {
  const { config, repos, razorpay, agent, model, logger } = deps;
  const econ = config.economics;

  async function audit(
    caseId: string | null,
    correlationId: string,
    event: string,
    actor: 'system' | 'agent' | 'policy' | 'operator',
    detail: Record<string, unknown>,
  ): Promise<void> {
    await repos.audit.insert({ caseId, correlationId, event, actor, detail });
  }

  async function resolvePolicy(merchantId: string): Promise<MerchantPolicy> {
    const stored = await repos.policies.getForMerchant(merchantId);
    return stored ?? defaultPolicy(merchantId);
  }

  async function handleFailed(event: InboundEvent, correlationId: string): Promise<void> {
    const p = event.payment;
    if (!p || !p.id) {
      logger.warn({ event: Events.PAYMENT_STATE_REJECTED, correlationId }, 'payment.failed without a payment entity');
      return;
    }
    const merchant = await repos.merchants.getOrCreate(DEFAULT_MERCHANT_NAME);
    const contact = p.contact ?? p.email ?? p.id;
    const contactHash = createHash('sha256').update(`${merchant.id}|${contact}`).digest('hex');
    const { customer } = await repos.customers.upsertByContact({
      merchantId: merchant.id,
      contactHash,
      customerKey: customerKey(contact),
      email: p.email,
      contact: p.contact,
    });

    const diag = classifyFailure({
      errorCode: p.errorCode,
      errorReason: p.errorReason,
      errorSource: p.errorSource,
      errorStep: p.errorStep,
      method: p.method,
    });

    const { payment } = await repos.payments.upsert({
      merchantId: merchant.id,
      customerId: customer.id,
      providerPaymentId: p.id,
      orderId: p.orderId,
      amount: p.amount,
      currency: p.currency,
      method: p.method,
      state: 'failed',
      failureCategory: diag.category,
      errorCode: p.errorCode,
      errorReason: p.errorReason,
      errorSource: p.errorSource,
      description: p.description,
    });
    logger.info({ event: Events.PAYMENT_UPSERTED, correlationId, paymentId: payment.id, state: payment.state }, 'payment stored');
    await repos.customers.applyCounters(customer.id, { failures: 1 });

    const existingCase = await repos.cases.getByPaymentId(payment.id);
    if (existingCase) {
      logger.info({ event: Events.WEBHOOK_DUPLICATE, correlationId, caseId: existingCase.id }, 'case already exists for payment');
      return;
    }

    const recoveryCase = await repos.cases.create({
      merchantId: merchant.id,
      customerId: customer.id,
      paymentId: payment.id,
      amountAtRisk: payment.amount,
      correlationId,
    });
    await audit(recoveryCase.id, correlationId, Events.CASE_OPENED, 'system', {
      amountAtRisk: payment.amount,
      failureCategory: diag.category,
      contact: redactContact(p.contact),
    });

    const policy = await resolvePolicy(merchant.id);
    const freshCustomer = (await repos.customers.getById(customer.id))!;
    const ctx = buildCaseContext({
      payment,
      customer: freshCustomer,
      recoveryCase,
      now: new Date(),
      failureTime: new Date(event.createdAt * 1000 || Date.now()),
    });

    const assessment = assessCase(ctx, model, policy, econ);
    logger.info(
      {
        event: Events.DECISION_EV,
        correlationId,
        caseId: recoveryCase.id,
        probability: Number(assessment.ev.recoveryProbability.toFixed(3)),
        expectedValuePaise: assessment.ev.expectedValuePaise,
        recommended: assessment.deterministic.recommendedAction,
        allowed: assessment.deterministic.allowedActions,
        scoreSource: assessment.score.source,
      },
      'recovery assessment computed',
    );
    await audit(recoveryCase.id, correlationId, Events.RISK_ASSESSED, 'system', {
      recoverabilityPrior: Number(assessment.risk.recoverabilityPrior.toFixed(3)),
      suspicious: assessment.risk.suspicious,
      signals: assessment.risk.signals.map((s) => s.name),
    });
    await audit(recoveryCase.id, correlationId, Events.RECOVERY_SCORED, 'system', {
      probability: Number(assessment.ev.recoveryProbability.toFixed(3)),
      source: assessment.score.source,
      modelVersion: assessment.score.modelVersion,
    });

    await decideAndAct(recoveryCase, ctx, assessment, payment, policy, correlationId);
  }

  async function decideAndAct(
    recoveryCase: RecoveryCase,
    ctx: CaseContext,
    assessment: RecoveryAssessment,
    payment: Payment,
    policy: MerchantPolicy,
    correlationId: string,
  ): Promise<void> {
    const { risk, score, ev, deterministic } = assessment;
    const factors = signalsToFactors(risk.signals);
    const attempt = ctx.attempts + 1;

    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const dailyActionsUsed = await repos.interventions.countActionsSince(ctx.merchantId, startOfDay);
    const lastAttempt = await repos.interventions.lastAttemptAt(recoveryCase.id);
    const minutesSinceLastAttempt = lastAttempt ? (Date.now() - lastAttempt.getTime()) / 60000 : null;

    logger.info({ event: Events.AGENT_STARTED, correlationId, caseId: recoveryCase.id, provider: agent ? 'set' : 'none' }, 'agent deciding');
    const agentDecision = await agent.decide({
      ctx,
      ev,
      factors,
      allowedActions: deterministic.allowedActions,
      recommendedAction: deterministic.recommendedAction,
      recommendedReason: deterministic.reasons[0] ?? 'Deterministic recommendation.',
    });
    logger.info(
      {
        event: agentDecision.rejected ? Events.AGENT_FALLBACK : Events.AGENT_COMPLETED,
        correlationId,
        caseId: recoveryCase.id,
        source: agentDecision.source,
        action: agentDecision.action,
        rejectionReason: agentDecision.rejectionReason,
        injectionDetected: agentDecision.injectionDetected,
        latencyMs: agentDecision.latencyMs,
      },
      'agent decided',
    );
    if (agentDecision.injectionDetected) {
      await audit(recoveryCase.id, correlationId, Events.INJECTION_BLOCKED, 'system', { note: 'Untrusted text flagged; treated as data only.' });
    }
    if (agentDecision.rejected) {
      await audit(recoveryCase.id, correlationId, Events.AGENT_REJECTED, 'system', { rejectionReason: agentDecision.rejectionReason });
    }

    const finalAction = agentDecision.action;
    const policyDecision = evaluatePolicy({
      action: finalAction,
      ctx,
      ev,
      policy,
      paymentState: payment.state,
      dailyActionsUsed,
      minutesSinceLastAttempt,
    });

    const decision = await repos.decisions.insert({
      caseId: recoveryCase.id,
      attempt,
      source: agentDecision.source,
      action: finalAction,
      reason: agentDecision.reason,
      recoveryProbability: ev.recoveryProbability,
      expectedValuePaise: ev.expectedValuePaise,
      confidence: agentDecision.confidence,
      factors,
      allowedActions: deterministic.allowedActions,
      policyApproved: policyDecision.approved,
      policyBlockReason: policyDecision.blockReason,
      modelVersion: score.modelVersion,
      policyVersion: policy.version,
      promptVersion: agentDecision.promptVersion,
      schemaVersion: agentDecision.schemaVersion,
    });

    await audit(recoveryCase.id, correlationId, policyDecision.approved ? Events.POLICY_APPROVED : Events.POLICY_BLOCKED, 'policy', {
      action: finalAction,
      blockReason: policyDecision.blockReason,
      expectedValuePaise: ev.expectedValuePaise,
    });

    if (!policyDecision.approved) {
      await handleBlocked(recoveryCase, policyDecision.stopReason, correlationId);
      return;
    }

    await executeAction(recoveryCase, finalAction, decision.id, ctx, ev, payment, policy, correlationId);
  }

  async function handleBlocked(recoveryCase: RecoveryCase, stopReason: StopReason | null, correlationId: string): Promise<void> {
    if (stopReason === 'value_requires_escalation') {
      await repos.cases.update(recoveryCase.id, { state: 'escalated', escalated: true });
      await audit(recoveryCase.id, correlationId, Events.CASE_ESCALATED, 'policy', { reason: stopReason });
      return;
    }
    if (stopReason === 'cooldown_active' || stopReason === 'budget_exhausted') {
      await repos.cases.update(recoveryCase.id, { state: 'decided' });
      await audit(recoveryCase.id, correlationId, Events.ACTION_SKIPPED, 'policy', { reason: stopReason });
      return;
    }
    await repos.cases.update(recoveryCase.id, { state: 'stopped', stopReason: stopReason ?? 'unrecoverable_failure', closedAt: new Date() });
    await audit(recoveryCase.id, correlationId, Events.CASE_STOPPED, 'policy', { reason: stopReason });
  }

  async function executeAction(
    recoveryCase: RecoveryCase,
    action: ActionType,
    decisionId: string,
    ctx: CaseContext,
    ev: RecoveryAssessment['ev'],
    payment: Payment,
    policy: MerchantPolicy,
    correlationId: string,
  ): Promise<void> {
    const attempt = ctx.attempts + 1;
    if (action === 'SEND_PAYMENT_LINK') {
      const referenceId = recoveryReferenceId(recoveryCase.id, attempt);
      const expiryMin = Math.min(policy.maxLinkExpiryMinutes, config.razorpay.linkExpiryDefaultMinutes);
      const expiresAt = new Date(Date.now() + expiryMin * 60000);
      logger.info({ event: Events.ACTION_STARTED, correlationId, caseId: recoveryCase.id, action }, 'creating payment link');
      try {
        const link = await razorpay.createPaymentLink({
          amount: ctx.amount,
          currency: ctx.currency,
          referenceId,
          description: `Recovery for payment ${payment.providerPaymentId}`,
          customer: { email: null, contact: null },
          expireByUnix: Math.floor(expiresAt.getTime() / 1000),
          notes: { case_id: recoveryCase.id, reference_id: referenceId },
        });
        await repos.interventions.insert({
          caseId: recoveryCase.id,
          decisionId,
          attempt,
          type: 'PAYMENT_LINK',
          status: 'created',
          providerObjectId: link.id,
          shortUrl: link.shortUrl,
          referenceId,
          amount: ctx.amount,
          expiresAt,
        });
        await repos.cases.update(recoveryCase.id, { state: 'link_created', attempts: attempt });
        await audit(recoveryCase.id, correlationId, Events.LINK_CREATED, 'system', { linkId: link.id, shortUrl: link.shortUrl, referenceId });
        await audit(recoveryCase.id, correlationId, Events.ACTION_EXECUTED, 'system', { action, expectedValuePaise: ev.expectedValuePaise });
        logger.info({ event: Events.LINK_CREATED, correlationId, caseId: recoveryCase.id, linkId: link.id }, 'link created');
      } catch (err) {
        const info = toErrorInfo(err);
        await repos.interventions.insert({
          caseId: recoveryCase.id,
          decisionId,
          attempt,
          type: 'PAYMENT_LINK',
          status: 'failed',
          providerObjectId: null,
          shortUrl: null,
          referenceId,
          amount: ctx.amount,
          expiresAt: null,
        });
        await repos.cases.update(recoveryCase.id, { state: 'decided' });
        await audit(recoveryCase.id, correlationId, Events.ACTION_FAILED, 'system', { action, error: info.message });
        logger.error({ event: Events.ACTION_FAILED, correlationId, caseId: recoveryCase.id, err: info }, 'payment link creation failed');
      }
      return;
    }

    if (action === 'RETRY_LATER') {
      const referenceId = recoveryReferenceId(recoveryCase.id, attempt);
      await repos.interventions.insert({
        caseId: recoveryCase.id,
        decisionId,
        attempt,
        type: 'RETRY_SCHEDULE',
        status: 'created',
        providerObjectId: null,
        shortUrl: null,
        referenceId,
        amount: ctx.amount,
        expiresAt: null,
      });
      await repos.cases.update(recoveryCase.id, { state: 'decided', attempts: attempt });
      await audit(recoveryCase.id, correlationId, Events.ACTION_EXECUTED, 'system', { action });
      return;
    }

    if (action === 'ESCALATE' || action === 'WAIT_OR_ESCALATE') {
      await repos.cases.update(recoveryCase.id, { state: 'escalated', escalated: true });
      await audit(recoveryCase.id, correlationId, Events.CASE_ESCALATED, 'system', { action });
      return;
    }

    if (action === 'STOP') {
      await repos.cases.update(recoveryCase.id, { state: 'stopped', stopReason: deriveStop(ctx), closedAt: new Date() });
      await audit(recoveryCase.id, correlationId, Events.CASE_STOPPED, 'system', { action, reason: deriveStop(ctx) });
      return;
    }

    // NO_ACTION
    await repos.cases.update(recoveryCase.id, { state: 'no_action', closedAt: new Date() });
    await audit(recoveryCase.id, correlationId, Events.CASE_COMPLETED, 'system', { action: 'NO_ACTION' });
  }

  async function handleLinkPaid(event: InboundEvent, correlationId: string): Promise<void> {
    const link = event.paymentLink;
    const referenceId = link?.referenceId ?? event.payment?.referenceId ?? null;
    if (!referenceId) {
      logger.warn({ event: Events.RECOVERY_ATTRIBUTED, correlationId }, 'payment_link.paid without a reference id');
      return;
    }
    const intervention = await repos.interventions.findByReferenceId(referenceId);
    if (!intervention) {
      logger.info({ event: Events.RECOVERY_ATTRIBUTED, correlationId, referenceId }, 'link paid not matched to an intervention');
      return;
    }
    const recovered = link?.amountPaid || link?.amount || event.payment?.amount || intervention.amount;
    await attributeRecovery(intervention.caseId, recovered, correlationId, intervention.id);
  }

  async function handleCaptured(event: InboundEvent, correlationId: string): Promise<void> {
    const p = event.payment;
    if (!p || !p.id) return;
    const merchant = await repos.merchants.getOrCreate(DEFAULT_MERCHANT_NAME);
    const contact = p.contact ?? p.email ?? p.id;
    const contactHash = createHash('sha256').update(`${merchant.id}|${contact}`).digest('hex');
    const { customer } = await repos.customers.upsertByContact({
      merchantId: merchant.id,
      contactHash,
      customerKey: customerKey(contact),
      email: p.email,
      contact: p.contact,
    });
    // Upsert as captured. If a payment already exists (for example a prior failure),
    // this upgrades it; a later stale failure cannot downgrade a captured payment.
    const { payment } = await repos.payments.upsert({
      merchantId: merchant.id,
      customerId: customer.id,
      providerPaymentId: p.id,
      orderId: p.orderId,
      amount: p.amount,
      currency: p.currency,
      method: p.method,
      state: 'captured',
      failureCategory: null,
      errorCode: null,
      errorReason: null,
      errorSource: null,
      description: p.description,
    });
    const recoveryCase = await repos.cases.getByPaymentId(payment.id);
    if (recoveryCase && recoveryCase.state !== 'recovered') {
      await attributeRecovery(recoveryCase.id, payment.amount, correlationId, null);
    }
  }

  async function attributeRecovery(caseId: string, recoveredAmount: number, correlationId: string, interventionId: string | null): Promise<void> {
    const recoveryCase = await repos.cases.getById(caseId);
    if (!recoveryCase || recoveryCase.state === 'recovered') return; // idempotent
    if (interventionId) await repos.interventions.updateStatus(interventionId, 'succeeded', new Date());
    await repos.cases.update(caseId, { state: 'recovered', recoveredAmount, closedAt: new Date() });
    await repos.customers.applyCounters(recoveryCase.customerId, { recoveries: 1, successes: 1 });
    await audit(caseId, correlationId, Events.RECOVERY_ATTRIBUTED, 'system', { recoveredAmount });
    await audit(caseId, correlationId, Events.CASE_RECOVERED, 'system', { recoveredAmount });
    logger.info({ event: Events.CASE_RECOVERED, correlationId, caseId, recoveredAmount }, 'recovery attributed');
  }

  return {
    async processEvent(event: InboundEvent, correlationId: string): Promise<void> {
      try {
        switch (event.eventType) {
          case 'payment.failed':
            await handleFailed(event, correlationId);
            break;
          case 'payment_link.paid':
            await handleLinkPaid(event, correlationId);
            break;
          case 'payment.captured':
          case 'order.paid':
            await handleCaptured(event, correlationId);
            break;
          default:
            logger.info({ event: Events.WEBHOOK_ACCEPTED, correlationId, eventType: event.eventType }, 'event ignored (not handled)');
        }
      } catch (err) {
        logger.error({ event: Events.WEBHOOK_REJECTED, correlationId, err: toErrorInfo(err) }, 'pipeline error');
        throw err;
      }
    },
  };
}

function deriveStop(ctx: CaseContext): StopReason {
  if (ctx.customer.optedOut) return 'customer_opt_out';
  if (ctx.failureCategory === 'risk_blocked') return 'suspicious';
  if (ctx.amount < 20000) return 'below_min_value';
  return 'unrecoverable_failure';
}
