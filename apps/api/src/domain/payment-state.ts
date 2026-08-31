import type { PaymentState } from './types';
import { DomainError } from '../util/errors';

/**
 * Legal payment transitions. `captured` is the confirmed-money terminal state:
 * a stale `failed` event arriving after a capture must never downgrade it.
 * A same-state transition is always allowed (idempotent re-delivery).
 */
const LEGAL: Record<PaymentState, PaymentState[]> = {
  created: ['authorized', 'captured', 'failed'],
  authorized: ['captured', 'failed'],
  failed: ['authorized', 'captured'], // a late success on the same id may upgrade
  captured: [], // terminal, cannot be downgraded
};

export function canTransitionPayment(from: PaymentState, to: PaymentState): boolean {
  return from === to || LEGAL[from].includes(to);
}

export function assertPaymentTransition(from: PaymentState, to: PaymentState): void {
  if (!canTransitionPayment(from, to)) {
    throw new DomainError(`Illegal payment transition ${from} -> ${to}`);
  }
}

export function isConfirmedSuccess(state: PaymentState): boolean {
  return state === 'captured';
}
