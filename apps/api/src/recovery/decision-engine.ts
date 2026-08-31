import type { Paise } from '../util/money';
import { weightedPaise, clamp01 } from '../util/money';
import type { CaseContext } from '../domain/context';
import type { ActionType, MerchantPolicy } from '../domain/types';
import type { RiskAssessment } from '../diagnosis/signals';
import type { RecoveryScore } from './scorer';

/**
 * The expected-value calculation and the bounded action set. This is fully
 * deterministic and is the single source of truth for money math. The AI may
 * later choose among `allowedActions`, but it can never widen the set, change
 * the numbers, or bypass the recommendation used as a fallback.
 */
export interface EvResult {
  recoveryProbability: number;
  baselineSelfRecovery: number;
  recoverableAmount: Paise;
  interventionCost: Paise;
  riskCost: Paise;
  /** Gross expected recovery if we act: probability * amount. */
  grossExpectedRecoveryPaise: Paise;
  /** Net expected value of acting, credited only for incremental (uplift) recovery. */
  expectedValuePaise: Paise;
}

export interface DeterministicDecision {
  ev: EvResult;
  allowedActions: ActionType[];
  recommendedAction: ActionType;
  reasons: string[];
}

export interface Economics {
  interventionCostPaise: Paise;
  riskCostFactor: number;
  baselineSelfRecovery: number;
}

export function computeEv(ctx: CaseContext, score: RecoveryScore, econ: Economics): EvResult {
  const p = clamp01(score.probability);
  const baseline = clamp01(econ.baselineSelfRecovery);
  const uplift = Math.max(0, p - baseline);
  const riskCost = ctx.failureCategory === 'risk_blocked' ? weightedPaise(ctx.amount, econ.riskCostFactor) : 0;
  const grossExpectedRecoveryPaise = weightedPaise(ctx.amount, p);
  const expectedValuePaise = Math.round(uplift * ctx.amount) - econ.interventionCostPaise - riskCost;
  return {
    recoveryProbability: p,
    baselineSelfRecovery: baseline,
    recoverableAmount: ctx.amount,
    interventionCost: econ.interventionCostPaise,
    riskCost,
    grossExpectedRecoveryPaise,
    expectedValuePaise,
  };
}

/**
 * Derive the bounded action set and a deterministic recommendation. The order
 * of checks encodes safety priority: opt-out and fraud stop first, then limits,
 * then value bounds, then the expected-value test that drives targeting.
 */
export function deriveDecision(
  ctx: CaseContext,
  risk: RiskAssessment,
  ev: EvResult,
  policy: MerchantPolicy,
): DeterministicDecision {
  const reasons: string[] = [];
  const allow = (actions: ActionType[], recommended: ActionType): DeterministicDecision => {
    const allowedActions = actions.filter((a) => a === 'STOP' || a === 'NO_ACTION' || policy.allowedActions.includes(a));
    const recommendedAction = allowedActions.includes(recommended) ? recommended : allowedActions[0] ?? 'NO_ACTION';
    return { ev, allowedActions, recommendedAction, reasons };
  };

  if (ctx.customer.optedOut) {
    reasons.push('Customer has opted out of recovery contact.');
    return allow(['STOP'], 'STOP');
  }
  if (risk.suspicious || ctx.failureCategory === 'risk_blocked') {
    reasons.push('Risk or fraud signal present; autonomous recovery is not allowed.');
    return allow(['STOP'], 'STOP');
  }
  if (ctx.attempts >= policy.maxAttempts) {
    reasons.push(`Recovery attempts exhausted (${ctx.attempts}/${policy.maxAttempts}).`);
    return allow(['STOP'], 'STOP');
  }
  if (ctx.amount < policy.minValuePaise) {
    reasons.push('Below the minimum value for recovery.');
    return allow(['NO_ACTION', 'STOP'], 'NO_ACTION');
  }
  if (ctx.amount >= policy.highValueEscalationPaise || ctx.amount > policy.maxAutonomousValuePaise) {
    reasons.push('High value transaction requires human review before contact.');
    return allow(['ESCALATE', 'STOP'], 'ESCALATE');
  }
  if (ev.expectedValuePaise <= policy.minExpectedValuePaise) {
    reasons.push('Expected recovery value does not justify an intervention.');
    return allow(['NO_ACTION', 'RETRY_LATER'], 'NO_ACTION');
  }
  if (ctx.transient && ctx.attempts === 0 && ctx.amount < 100000) {
    // Low value transient failure: a scheduled retry is a cheaper first step
    // than a customer contact. Higher value recoverable failures go straight to
    // a payment link, which is the primary recovery mechanism.
    reasons.push('Low value transient failure on first attempt; a scheduled retry is low cost.');
    return allow(['RETRY_LATER', 'SEND_PAYMENT_LINK', 'NO_ACTION'], 'RETRY_LATER');
  }
  if (ctx.attempts >= 1) {
    reasons.push('A prior attempt was made; escalate to review if the next attempt does not convert.');
    return allow(['SEND_PAYMENT_LINK', 'WAIT_OR_ESCALATE', 'STOP'], 'SEND_PAYMENT_LINK');
  }

  reasons.push('Positive expected value with a recoverable failure and no prior attempt.');
  return allow(['SEND_PAYMENT_LINK', 'RETRY_LATER', 'NO_ACTION'], 'SEND_PAYMENT_LINK');
}
