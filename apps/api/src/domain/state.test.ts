import { describe, it, expect } from 'vitest';
import { canTransitionPayment } from './payment-state';
import { canTransitionCase } from './case-state';

describe('payment state machine', () => {
  it('never downgrades a captured payment (stale failed event)', () => {
    expect(canTransitionPayment('captured', 'failed')).toBe(false);
    expect(canTransitionPayment('captured', 'authorized')).toBe(false);
  });

  it('allows a failed payment to later capture', () => {
    expect(canTransitionPayment('failed', 'captured')).toBe(true);
  });

  it('allows a same-state (idempotent) transition', () => {
    expect(canTransitionPayment('failed', 'failed')).toBe(true);
    expect(canTransitionPayment('captured', 'captured')).toBe(true);
  });
});

describe('case state machine', () => {
  it('treats recovered as terminal', () => {
    expect(canTransitionCase('recovered', 'stopped')).toBe(false);
    expect(canTransitionCase('recovered', 'link_created')).toBe(false);
  });

  it('lets a stopped or no-action case still become recovered (late self payment)', () => {
    expect(canTransitionCase('stopped', 'recovered')).toBe(true);
    expect(canTransitionCase('no_action', 'recovered')).toBe(true);
  });

  it('follows the normal recovery path', () => {
    expect(canTransitionCase('open', 'assessed')).toBe(true);
    expect(canTransitionCase('decided', 'link_created')).toBe(true);
    expect(canTransitionCase('link_created', 'recovered')).toBe(true);
  });
});
