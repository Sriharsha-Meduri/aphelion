import type { CaseState } from './types';
import { DomainError } from '../util/errors';

/**
 * Recovery case transitions. `recovered` is terminal and reachable from almost
 * anywhere, because a customer can pay at any time (even after the case was
 * stopped or marked no_action). Once recovered, nothing may change it.
 */
const LEGAL: Record<CaseState, CaseState[]> = {
  open: ['assessed', 'no_action', 'stopped', 'recovered'],
  assessed: ['decided', 'no_action', 'stopped', 'escalated', 'recovered'],
  decided: ['link_created', 'attempted', 'stopped', 'escalated', 'no_action', 'recovered'],
  link_created: ['attempted', 'recovered', 'stopped', 'escalated'],
  attempted: ['recovered', 'stopped', 'escalated', 'link_created'],
  escalated: ['decided', 'link_created', 'attempted', 'stopped', 'recovered'],
  no_action: ['recovered'],
  stopped: ['recovered'],
  recovered: [],
};

export function canTransitionCase(from: CaseState, to: CaseState): boolean {
  return from === to || LEGAL[from].includes(to);
}

export function assertCaseTransition(from: CaseState, to: CaseState): void {
  if (!canTransitionCase(from, to)) {
    throw new DomainError(`Illegal case transition ${from} -> ${to}`);
  }
}

export function isCaseTerminal(state: CaseState): boolean {
  return state === 'recovered' || state === 'stopped' || state === 'no_action';
}

/** Terminal states an operator can still reopen (recovered cannot be reopened). */
export function isReopenable(state: CaseState): boolean {
  return state === 'stopped' || state === 'no_action' || state === 'escalated';
}
