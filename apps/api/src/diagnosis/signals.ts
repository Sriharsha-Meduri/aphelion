import type { CaseContext } from '../domain/context';
import type { DecisionFactor } from '../domain/types';
import { clamp01 } from '../util/money';

/**
 * A single piece of explainable evidence. Detectors are independent: one
 * throwing does not take down the assessment, it only lowers coverage. This
 * mirrors a reachable-only consensus rather than a single monolithic score.
 */
export interface Signal {
  name: string;
  detail: string;
  severity: number; // 0..1 magnitude
  weight: number; // relative importance
  direction: 'supports' | 'opposes' | 'neutral'; // supports = favours a recovery action
}

export interface RiskAssessment {
  /** Heuristic aggregate prior in [0,1]. Used for explainability and as a model-free fallback. */
  recoverabilityPrior: number;
  suspicious: boolean;
  /** Higher means more reason to be cautious (fraud, stale, opted-out, exhausted). */
  riskScore: number;
  /** Fraction of detectors that ran successfully. */
  confidence: number;
  signals: Signal[];
  degradedDetectors: string[];
}

type Detector = { name: string; run: (ctx: CaseContext) => Signal };

const DETECTORS: Detector[] = [
  {
    name: 'failure_type',
    run: (ctx) => ({
      name: 'failure_type',
      detail: `Failure category ${ctx.failureCategory}${ctx.transient ? ' (transient)' : ''}`,
      severity: ctx.baseRecoverability,
      weight: 1.4,
      direction: ctx.baseRecoverability >= 0.45 ? 'supports' : 'opposes',
    }),
  },
  {
    name: 'value_tier',
    run: (ctx) => ({
      name: 'value_tier',
      detail: `Transaction value tier ${ctx.valueTier}`,
      severity: ctx.valueTier === 'premium' ? 1 : ctx.valueTier === 'high' ? 0.8 : ctx.valueTier === 'medium' ? 0.5 : 0.25,
      weight: 1.1,
      direction: ctx.valueTier === 'low' ? 'opposes' : 'supports',
    }),
  },
  {
    name: 'attempt_history',
    run: (ctx) => ({
      name: 'attempt_history',
      detail: `${ctx.attempts} prior recovery attempt(s)`,
      severity: clamp01(ctx.attempts / 3),
      weight: 1.2,
      direction: ctx.attempts === 0 ? 'supports' : 'opposes',
    }),
  },
  {
    name: 'customer_reliability',
    run: (ctx) => {
      const c = ctx.customer;
      const total = c.priorSuccesses + c.priorFailures;
      const successRate = total > 0 ? c.priorSuccesses / total : 0.5;
      return {
        name: 'customer_reliability',
        detail: `Customer has ${c.priorSuccesses} prior success(es), ${c.priorRecoveries} prior recovery(ies)`,
        severity: clamp01(successRate),
        weight: 1.0,
        direction: successRate >= 0.5 || c.priorRecoveries > 0 ? 'supports' : 'neutral',
      };
    },
  },
  {
    name: 'opt_out',
    run: (ctx) => ({
      name: 'opt_out',
      detail: ctx.customer.optedOut ? 'Customer has opted out of recovery contact' : 'Customer is contactable',
      severity: ctx.customer.optedOut ? 1 : 0,
      weight: 2.0,
      direction: ctx.customer.optedOut ? 'opposes' : 'neutral',
    }),
  },
  {
    name: 'timing',
    run: (ctx) => ({
      name: 'timing',
      detail: `${Math.round(ctx.timeSinceFailureMinutes)} min since failure, ${ctx.isBusinessHours ? 'business hours' : 'off hours'}`,
      severity: clamp01(ctx.timeSinceFailureMinutes / (60 * 24)),
      weight: 0.7,
      direction: ctx.timeSinceFailureMinutes > 60 * 24 ? 'opposes' : ctx.isBusinessHours ? 'supports' : 'neutral',
    }),
  },
  {
    name: 'suspicion',
    run: (ctx) => ({
      name: 'suspicion',
      detail: ctx.failureCategory === 'risk_blocked' ? 'Risk or fraud signal present' : 'No risk signal',
      severity: ctx.failureCategory === 'risk_blocked' ? 1 : 0,
      weight: 3.0,
      direction: ctx.failureCategory === 'risk_blocked' ? 'opposes' : 'neutral',
    }),
  },
];

/**
 * Run every detector defensively and aggregate. `recoverabilityPrior` starts
 * from the failure base and is nudged by the supporting and opposing signals.
 * `confidence` reflects how many detectors were reachable.
 */
export function assessRisk(ctx: CaseContext): RiskAssessment {
  const signals: Signal[] = [];
  const degraded: string[] = [];

  for (const d of DETECTORS) {
    try {
      signals.push(d.run(ctx));
    } catch {
      degraded.push(d.name);
    }
  }

  let numer = ctx.baseRecoverability * 1.5;
  let denom = 1.5;
  for (const s of signals) {
    if (s.direction === 'neutral') continue;
    const contribution = s.direction === 'supports' ? s.severity : 1 - s.severity;
    numer += contribution * s.weight;
    denom += s.weight;
  }
  const recoverabilityPrior = clamp01(numer / denom);

  const suspicious = signals.some((s) => s.name === 'suspicion' && s.severity >= 1) || ctx.customer.optedOut;
  const opposition = signals.filter((s) => s.direction === 'opposes').reduce((a, s) => a + s.severity * s.weight, 0);
  const riskScore = clamp01(opposition / 6);
  const confidence = clamp01(signals.length / DETECTORS.length);

  const sorted = [...signals].sort((a, b) => b.weight * b.severity - a.weight * a.severity).slice(0, 6);

  return { recoverabilityPrior, suspicious, riskScore, confidence, signals: sorted, degradedDetectors: degraded };
}

export function signalsToFactors(signals: Signal[]): DecisionFactor[] {
  return signals.map((s) => ({ label: s.name, detail: s.detail, weight: Number(s.weight.toFixed(2)), direction: s.direction }));
}
