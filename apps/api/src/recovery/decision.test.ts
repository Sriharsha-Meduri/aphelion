import { describe, it, expect } from 'vitest';
import { assessCase } from './decide';
import { computeEv } from './decision-engine';
import { defaultPolicy } from '../policy/defaults';
import type { CaseContext } from '../domain/context';
import { valueTier } from '../util/money';

const policy = defaultPolicy('m');
const econ = { interventionCostPaise: 300, riskCostFactor: 0.5, baselineSelfRecovery: 0.08 };

function ctx(o: Partial<CaseContext> = {}): CaseContext {
  const amount = o.amount ?? 150000;
  return {
    caseId: 'c',
    correlationId: 'cor',
    merchantId: 'm',
    amount,
    currency: 'INR',
    valueTier: valueTier(amount),
    method: 'card',
    failureCategory: 'card_declined',
    transient: false,
    baseRecoverability: 0.4,
    errorCode: null,
    errorReason: null,
    errorSource: null,
    attempts: 0,
    timeSinceFailureMinutes: 15,
    hourOfDay: 12,
    isBusinessHours: true,
    customer: { customerKey: 'k', priorSuccesses: 4, priorFailures: 1, priorRecoveries: 1, optedOut: false, ageDays: 300, recencyDays: 5 },
    descriptionRaw: null,
    ...o,
  };
}

const recommend = (c: CaseContext) => assessCase(c, null, policy, econ).deterministic.recommendedAction;

describe('deterministic decision engine', () => {
  it('stops when the customer has opted out', () => {
    expect(recommend(ctx({ customer: { ...ctx().customer, optedOut: true } }))).toBe('STOP');
  });

  it('stops on a suspicious (risk blocked) failure', () => {
    expect(recommend(ctx({ failureCategory: 'risk_blocked' }))).toBe('STOP');
  });

  it('escalates a high value transaction', () => {
    expect(recommend(ctx({ amount: 3000000 }))).toBe('ESCALATE');
  });

  it('takes no action below the minimum value', () => {
    expect(recommend(ctx({ amount: 5000 }))).toBe('NO_ACTION');
  });

  it('stops when attempts are exhausted', () => {
    expect(recommend(ctx({ attempts: 2 }))).toBe('STOP');
  });

  it('sends a payment link for a recoverable positive value case', () => {
    expect(recommend(ctx({ amount: 200000 }))).toBe('SEND_PAYMENT_LINK');
  });

  it('computes expected value as uplift over baseline minus cost', () => {
    const c = ctx({ amount: 100000 });
    const ev = computeEv(c, { probability: 0.5, source: 'heuristic', modelVersion: 'v' }, econ);
    // (0.5 - 0.08) * 100000 - 300 = 42000 - 300 = 41700
    expect(ev.expectedValuePaise).toBe(41700);
    expect(ev.grossExpectedRecoveryPaise).toBe(50000);
  });

  it('applies a risk cost that pushes suspicious cases below the value threshold', () => {
    const c = ctx({ failureCategory: 'risk_blocked', amount: 100000 });
    const ev = computeEv(c, { probability: 0.5, source: 'heuristic', modelVersion: 'v' }, econ);
    expect(ev.riskCost).toBeGreaterThan(0);
  });
});
