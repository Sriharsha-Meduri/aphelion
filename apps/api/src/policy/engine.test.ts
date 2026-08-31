import { describe, it, expect } from 'vitest';
import { evaluatePolicy, type PolicyInput } from './engine';
import { defaultPolicy } from './defaults';
import type { CaseContext } from '../domain/context';
import type { EvResult } from '../recovery/decision-engine';

const policy = defaultPolicy('m');
const ev: EvResult = {
  recoveryProbability: 0.5,
  baselineSelfRecovery: 0.08,
  recoverableAmount: 200000,
  interventionCost: 300,
  riskCost: 0,
  grossExpectedRecoveryPaise: 100000,
  expectedValuePaise: 83700,
};

function ctx(o: Partial<CaseContext> = {}): CaseContext {
  return {
    caseId: 'c', correlationId: 'cor', merchantId: 'm', amount: 200000, currency: 'INR', valueTier: 'medium',
    method: 'card', failureCategory: 'card_declined', transient: false, baseRecoverability: 0.4,
    errorCode: null, errorReason: null, errorSource: null, attempts: 0, timeSinceFailureMinutes: 15,
    hourOfDay: 12, isBusinessHours: true,
    customer: { customerKey: 'k', priorSuccesses: 4, priorFailures: 1, priorRecoveries: 1, optedOut: false, ageDays: 300, recencyDays: 5 },
    descriptionRaw: null, ...o,
  };
}

function base(o: Partial<PolicyInput> = {}): PolicyInput {
  return { action: 'SEND_PAYMENT_LINK', ctx: ctx(), ev, policy, paymentState: 'failed', dailyActionsUsed: 0, minutesSinceLastAttempt: null, ...o };
}

describe('policy gate', () => {
  it('approves a valid send', () => {
    expect(evaluatePolicy(base()).approved).toBe(true);
  });

  it('blocks a send on an already captured payment', () => {
    const r = evaluatePolicy(base({ paymentState: 'captured' }));
    expect(r.approved).toBe(false);
    expect(r.stopReason).toBe('already_paid');
  });

  it('blocks a send to an opted-out customer', () => {
    const r = evaluatePolicy(base({ ctx: ctx({ customer: { ...ctx().customer, optedOut: true } }) }));
    expect(r.approved).toBe(false);
    expect(r.stopReason).toBe('customer_opt_out');
  });

  it('blocks a send on a suspicious case', () => {
    const r = evaluatePolicy(base({ ctx: ctx({ failureCategory: 'risk_blocked' }) }));
    expect(r.approved).toBe(false);
    expect(r.stopReason).toBe('suspicious');
  });

  it('blocks during cooldown', () => {
    const r = evaluatePolicy(base({ minutesSinceLastAttempt: 10 }));
    expect(r.approved).toBe(false);
    expect(r.stopReason).toBe('cooldown_active');
  });

  it('blocks when the daily budget is exhausted', () => {
    const r = evaluatePolicy(base({ dailyActionsUsed: policy.dailyActionBudget }));
    expect(r.approved).toBe(false);
    expect(r.stopReason).toBe('budget_exhausted');
  });

  it('blocks a high value case that needs escalation', () => {
    const r = evaluatePolicy(base({ ctx: ctx({ amount: 3000000 }) }));
    expect(r.approved).toBe(false);
    expect(r.stopReason).toBe('value_requires_escalation');
  });

  it('always allows non money-moving actions', () => {
    for (const action of ['STOP', 'NO_ACTION', 'ESCALATE', 'WAIT_OR_ESCALATE'] as const) {
      expect(evaluatePolicy(base({ action })).approved).toBe(true);
    }
  });
});
