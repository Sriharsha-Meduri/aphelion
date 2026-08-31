import { describe, it, expect } from 'vitest';
import { classifyFailure } from './failure-classifier';

describe('failure classifier', () => {
  it('maps insufficient funds to a recoverable category', () => {
    const d = classifyFailure({ errorReason: 'insufficient_funds', errorSource: 'customer' });
    expect(d.category).toBe('insufficient_funds');
    expect(d.suspicious).toBe(false);
    expect(d.baseRecoverability).toBeGreaterThan(0.4);
  });

  it('flags fraud and risk failures as suspicious and low recovery', () => {
    const d = classifyFailure({ errorReason: 'payment_failed_risk_check', errorSource: 'razorpay' });
    expect(d.category).toBe('risk_blocked');
    expect(d.suspicious).toBe(true);
    expect(d.baseRecoverability).toBeLessThan(0.1);
  });

  it('marks gateway and network errors as transient', () => {
    expect(classifyFailure({ errorReason: 'gateway_technical_error' }).transient).toBe(true);
    expect(classifyFailure({ errorReason: 'network_timeout' }).transient).toBe(true);
  });

  it('falls back to unknown with a moderate prior', () => {
    const d = classifyFailure({ errorReason: 'something_new_and_weird' });
    expect(d.category).toBe('unknown');
    expect(d.baseRecoverability).toBeGreaterThan(0);
    expect(d.baseRecoverability).toBeLessThan(0.5);
  });
});
