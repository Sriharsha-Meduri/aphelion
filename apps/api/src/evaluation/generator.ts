import { Rng } from './rng';
import { clamp01, valueTier, type Paise } from '../util/money';
import { classifyFailure } from '../diagnosis/failure-classifier';
import type { CaseContext } from '../domain/context';
import type { ActionType, FailureCategory } from '../domain/types';

/**
 * Reproducible synthetic dataset for a payment recovery merchant.
 *
 * Honesty note: this is a SYNTHETIC environment. A latent per-customer
 * reliability drives a ground-truth "would recover if sent a link" outcome.
 * The model only sees observable, decision-time features (amount, method,
 * failure type, prior counts, timing), never the latent reliability, so it has
 * to learn a real signal. The label is an exact function of the generator, and
 * customers are split as a group so no customer appears in two splits.
 */

export interface DatasetConfig {
  seed: number;
  numCases: number;
  baselineSelfRecovery: number;
  retryTransientFactor: number;
  retryHardFactor: number;
}

export const DEFAULT_DATASET: DatasetConfig = {
  seed: 42,
  numCases: 2000,
  baselineSelfRecovery: 0.08,
  retryTransientFactor: 0.6,
  retryHardFactor: 0.25,
};

export type Split = 'train' | 'val' | 'test';

export interface SyntheticCase {
  id: string;
  customerId: string;
  split: Split;
  amount: Paise;
  currency: string;
  method: string;
  failureCategory: FailureCategory;
  errorCode: string;
  errorReason: string;
  errorSource: string;
  errorStep: string;
  transient: boolean;
  attempts: number;
  timeSinceFailureMinutes: number;
  hourOfDay: number;
  isBusinessHours: boolean;
  optedOut: boolean;
  priorSuccesses: number;
  priorFailures: number;
  priorRecoveries: number;
  ageDays: number;
  recencyDays: number;
  descriptionRaw: string | null;
  pRecoverIfLink: number;
  u: number;
  labelRecoverIfLink: 0 | 1;
}

const FAILURES: { value: FailureCategory; weight: number; code: string; reason: string; source: string; step: string }[] = [
  { value: 'insufficient_funds', weight: 20, code: 'BAD_REQUEST_ERROR', reason: 'insufficient_funds', source: 'customer', step: 'payment_authorization' },
  { value: 'authentication_failed', weight: 18, code: 'BAD_REQUEST_ERROR', reason: 'payment_authentication_failed', source: 'customer', step: 'payment_authentication' },
  { value: 'card_declined', weight: 16, code: 'GATEWAY_ERROR', reason: 'card_declined_by_issuer', source: 'bank', step: 'payment_authorization' },
  { value: 'gateway_error', weight: 12, code: 'GATEWAY_ERROR', reason: 'gateway_technical_error', source: 'gateway', step: 'payment_authorization' },
  { value: 'network_timeout', weight: 10, code: 'GATEWAY_ERROR', reason: 'network_timeout_error', source: 'network', step: 'payment_authorization' },
  { value: 'customer_dropped', weight: 10, code: 'BAD_REQUEST_ERROR', reason: 'payment_cancelled_by_user', source: 'customer', step: 'payment_initiation' },
  { value: 'expired_instrument', weight: 8, code: 'BAD_REQUEST_ERROR', reason: 'card_expired', source: 'customer', step: 'payment_authorization' },
  { value: 'risk_blocked', weight: 3, code: 'BAD_REQUEST_ERROR', reason: 'payment_failed_risk_check', source: 'razorpay', step: 'payment_authorization' },
];

const METHODS = [
  { value: 'card', weight: 45 },
  { value: 'upi', weight: 35 },
  { value: 'netbanking', weight: 12 },
  { value: 'wallet', weight: 8 },
];

const TIERS = [
  { value: 'low', weight: 40, lo: 5000, hi: 49900 },
  { value: 'medium', weight: 35, lo: 50000, hi: 299900 },
  { value: 'high', weight: 20, lo: 300000, hi: 1999900 },
  { value: 'premium', weight: 5, lo: 2000000, hi: 8000000 },
];

export function generateDataset(config: DatasetConfig = DEFAULT_DATASET): SyntheticCase[] {
  const rng = new Rng(config.seed);
  const cases: SyntheticCase[] = [];
  let ci = 0;

  while (cases.length < config.numCases) {
    ci += 1;
    const customerId = `c_${ci.toString().padStart(6, '0')}`;
    const split = customerSplit(config.seed, ci);
    const reliability = clamp01(rng.normal(0.55, 0.23));
    // The prior counts are the observable proxy for the latent reliability. We
    // keep them a strong but noisy signal (discretized history + small noise),
    // so the model can learn a real ranking without the task becoming trivial.
    const totalHistory = rng.int(2, 14);
    const successes = Math.max(0, Math.min(totalHistory, Math.round(reliability * totalHistory + rng.normal(0, 0.9))));
    const failures = totalHistory - successes;
    const recoveries = rng.bernoulli(reliability * 0.5) ? rng.int(0, 2) : 0;
    const optedOut = rng.bernoulli(0.05);
    const ageDays = rng.int(1, 720);
    const recencyDays = rng.int(0, ageDays);

    const perCustomer = rng.int(1, 4);
    for (let k = 0; k < perCustomer && cases.length < config.numCases; k += 1) {
      const fail = rng.weighted(FAILURES.map((f) => ({ value: f, weight: f.weight })));
      const method = rng.weighted(METHODS.map((m) => ({ value: m.value, weight: m.weight })));
      const tier = rng.weighted(TIERS.map((t) => ({ value: t, weight: t.weight })));
      const amount = Math.round(rng.uniform(tier.lo, tier.hi) / 100) * 100;
      const attempts = rng.bernoulli(0.18) ? 1 : 0;
      const hourOfDay = rng.int(0, 23);
      const isBusinessHours = hourOfDay >= 9 && hourOfDay < 21;
      const timeSinceFailureMinutes = rng.uniform(1, 60 * 20);

      const diag = classifyFailure({ errorCode: fail.code, errorReason: fail.reason, errorSource: fail.source, errorStep: fail.step, method });
      const tierOrd = tier.value === 'low' ? 0 : tier.value === 'medium' ? 1 : tier.value === 'high' ? 2 : 3;

      let p = 0.3 * diag.baseRecoverability + 0.6 * reliability + 0.05;
      p -= [0, 0.03, 0.08, 0.14][tierOrd];
      if (attempts > 0) p *= 0.55;
      if (isBusinessHours) p += 0.03;
      p -= Math.min(0.1, recencyDays / 3650);
      p += rng.normal(0, 0.05);
      p = clamp01(p);
      if (diag.category === 'risk_blocked') p = Math.min(p, 0.05);

      const u = rng.next();
      cases.push({
        id: `s_${(cases.length + 1).toString().padStart(6, '0')}`,
        customerId,
        split,
        amount,
        currency: 'INR',
        method,
        failureCategory: diag.category,
        errorCode: fail.code,
        errorReason: fail.reason,
        errorSource: fail.source,
        errorStep: fail.step,
        transient: diag.transient,
        attempts,
        timeSinceFailureMinutes,
        hourOfDay,
        isBusinessHours,
        optedOut,
        priorSuccesses: successes,
        priorFailures: failures,
        priorRecoveries: recoveries,
        ageDays,
        recencyDays,
        descriptionRaw: null,
        pRecoverIfLink: p,
        u,
        labelRecoverIfLink: u < p ? 1 : 0,
      });
    }
  }
  return cases;
}

function customerSplit(seed: number, customerIndex: number): Split {
  const r = new Rng(seed * 1_000_003 + customerIndex).next();
  if (r < 0.7) return 'train';
  if (r < 0.85) return 'val';
  return 'test';
}

export function toContext(sc: SyntheticCase): CaseContext {
  return {
    caseId: sc.id,
    correlationId: `eval_${sc.id}`,
    merchantId: 'eval',
    amount: sc.amount,
    currency: sc.currency,
    valueTier: valueTier(sc.amount),
    method: sc.method,
    failureCategory: sc.failureCategory,
    transient: sc.transient,
    baseRecoverability: classifyFailure({ errorCode: sc.errorCode, errorReason: sc.errorReason, errorSource: sc.errorSource, errorStep: sc.errorStep, method: sc.method }).baseRecoverability,
    errorCode: sc.errorCode,
    errorReason: sc.errorReason,
    errorSource: sc.errorSource,
    attempts: sc.attempts,
    timeSinceFailureMinutes: sc.timeSinceFailureMinutes,
    hourOfDay: sc.hourOfDay,
    isBusinessHours: sc.isBusinessHours,
    customer: {
      customerKey: `cust_${sc.customerId.slice(-6)}`,
      priorSuccesses: sc.priorSuccesses,
      priorFailures: sc.priorFailures,
      priorRecoveries: sc.priorRecoveries,
      optedOut: sc.optedOut,
      ageDays: sc.ageDays,
      recencyDays: sc.recencyDays,
    },
    descriptionRaw: sc.descriptionRaw,
  };
}

/**
 * The outcome oracle. Given a case and the action taken, it decides whether the
 * customer paid, using the case's fixed uniform draw so the counterfactual is
 * consistent across actions (an uplift setup).
 */
export function oracleRecovered(sc: SyntheticCase, action: ActionType, config: DatasetConfig): boolean {
  // Escalation routes the case to a human who then sends a link, so its outcome
  // matches a link (a real merchant does recover high-value cases, just with a
  // person in the loop). Retry is a cheaper first step that converts less often.
  if (action === 'SEND_PAYMENT_LINK' || action === 'ESCALATE' || action === 'WAIT_OR_ESCALATE') {
    return sc.u < sc.pRecoverIfLink;
  }
  if (action === 'RETRY_LATER') {
    const factor = sc.transient ? config.retryTransientFactor : config.retryHardFactor;
    return sc.u < sc.pRecoverIfLink * factor;
  }
  return sc.u < config.baselineSelfRecovery;
}
