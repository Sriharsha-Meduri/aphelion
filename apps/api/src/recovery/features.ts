import type { CaseContext } from '../domain/context';

/**
 * Feature vector for the recovery-probability model. Every feature is knowable
 * at decision time, so there is no leakage of the outcome we are predicting.
 * Order is fixed and shared by training and serving.
 */
export const FEATURE_NAMES = [
  'log_amount_rupees',
  'base_recoverability',
  'transient',
  'attempts',
  'hours_since_failure',
  'prior_successes',
  'prior_failures',
  'prior_recoveries',
  'success_rate',
  'recency_days',
  'age_days',
  'is_business_hours',
  'value_tier_ord',
  'is_card',
  'is_upi',
  'is_risk_blocked',
  'is_authentication',
  'is_insufficient_funds',
] as const;

export function extractFeatures(ctx: CaseContext): number[] {
  const c = ctx.customer;
  const total = c.priorSuccesses + c.priorFailures;
  const successRate = total > 0 ? c.priorSuccesses / total : 0.5;
  const tierOrd = ctx.valueTier === 'low' ? 0 : ctx.valueTier === 'medium' ? 1 : ctx.valueTier === 'high' ? 2 : 3;
  const method = (ctx.method ?? '').toLowerCase();
  return [
    Math.log1p(ctx.amount / 100),
    ctx.baseRecoverability,
    ctx.transient ? 1 : 0,
    Math.min(5, ctx.attempts),
    Math.min(72, ctx.timeSinceFailureMinutes / 60),
    Math.min(20, c.priorSuccesses),
    Math.min(20, c.priorFailures),
    Math.min(10, c.priorRecoveries),
    successRate,
    Math.min(365, c.recencyDays),
    Math.min(365, c.ageDays),
    ctx.isBusinessHours ? 1 : 0,
    tierOrd,
    method.includes('card') ? 1 : 0,
    method.includes('upi') ? 1 : 0,
    ctx.failureCategory === 'risk_blocked' ? 1 : 0,
    ctx.failureCategory === 'authentication_failed' ? 1 : 0,
    ctx.failureCategory === 'insufficient_funds' ? 1 : 0,
  ];
}
