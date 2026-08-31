import type { ActionType, MerchantPolicy } from '../domain/types';
import type { RecoveryModel } from '../recovery/model';
import type { SyntheticCase } from './generator';
import { toContext } from './generator';
import { assessCase, type RecoveryAssessment } from '../recovery/decide';
import { assessRisk } from '../diagnosis/signals';
import { scoreRecovery } from '../recovery/scorer';
import { computeEv, type Economics } from '../recovery/decision-engine';
import { evaluatePolicy } from '../policy/engine';

export interface PolicyDeps {
  model: RecoveryModel | null;
  policy: MerchantPolicy;
  econ: Economics;
}

export type PolicyFn = (sc: SyntheticCase, deps: PolicyDeps) => ActionType;

/**
 * Baseline and Project Aphelion action policies, compared on the same held-out cases
 * with the same outcome oracle.
 *  - no_action: never intervene (floor).
 *  - contact_all: naive automation, contact everyone except hard-safety stops.
 *  - rules: a sensible human heuristic.
 *  - ml_only: intervene when the model's expected value is positive (no policy).
 *  - aphelion: full engine (calibrated model + EV targeting + policy gates).
 */
export const actionPolicies: Record<string, PolicyFn> = {
  no_action: () => 'NO_ACTION',

  contact_all: (sc) => (sc.optedOut || sc.failureCategory === 'risk_blocked' ? 'NO_ACTION' : 'SEND_PAYMENT_LINK'),

  rules: (sc) => {
    if (sc.optedOut || sc.failureCategory === 'risk_blocked') return 'NO_ACTION';
    if (sc.attempts >= 2) return 'NO_ACTION';
    if (sc.amount < 50000) return 'NO_ACTION'; // skip under Rs 500
    if (sc.failureCategory === 'expired_instrument') return 'NO_ACTION';
    return 'SEND_PAYMENT_LINK';
  },

  ml_only: (sc, deps) => {
    if (sc.optedOut || sc.failureCategory === 'risk_blocked') return 'NO_ACTION';
    const ctx = toContext(sc);
    const risk = assessRisk(ctx);
    const score = scoreRecovery(ctx, risk, deps.model);
    const ev = computeEv(ctx, score, deps.econ);
    return ev.expectedValuePaise > 0 ? 'SEND_PAYMENT_LINK' : 'NO_ACTION';
  },

  aphelion: (sc, deps) => {
    const ctx = toContext(sc);
    const a: RecoveryAssessment = assessCase(ctx, deps.model, deps.policy, deps.econ);
    const action = a.deterministic.recommendedAction;
    const gate = evaluatePolicy({
      action,
      ctx,
      ev: a.ev,
      policy: deps.policy,
      paymentState: 'failed',
      dailyActionsUsed: 0,
      minutesSinceLastAttempt: null,
    });
    return gate.approved ? action : 'STOP';
  },
};

/**
 * Ranking scores for the budgeted targeting evaluation: given a fixed contact
 * budget, each strategy orders cases by its own priority and we contact the top
 * ones. This isolates targeting quality from action taxonomy.
 */
export const rankScores: Record<string, (sc: SyntheticCase, deps: PolicyDeps) => number> = {
  random: (sc) => hash(sc.id),
  by_amount: (sc) => (sc.optedOut || sc.failureCategory === 'risk_blocked' ? -1 : sc.amount),
  aphelion: (sc, deps) => {
    if (sc.optedOut || sc.failureCategory === 'risk_blocked') return -1;
    const ctx = toContext(sc);
    const risk = assessRisk(ctx);
    const score = scoreRecovery(ctx, risk, deps.model);
    // Rank by expected recovery value (probability times amount).
    return score.probability * sc.amount;
  },
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}
