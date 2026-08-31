import type { CaseContext } from '../domain/context';
import type { ActionType, MerchantPolicy, PaymentState, StopReason } from '../domain/types';
import type { EvResult } from '../recovery/decision-engine';

/**
 * The deterministic policy gate. Every action, whatever recommended it, passes
 * through here before execution. This is intentionally independent of the AI:
 * even a valid-looking but unsafe recommendation (send a link on an already
 * captured payment, contact an opted-out customer, exceed the attempt limit) is
 * blocked here. If a gate fails, the action does not execute and the reason is
 * recorded.
 */
export interface PolicyDecision {
  approved: boolean;
  blockReason: string | null;
  stopReason: StopReason | null;
}

export interface PolicyInput {
  action: ActionType;
  ctx: CaseContext;
  ev: EvResult;
  policy: MerchantPolicy;
  paymentState: PaymentState;
  dailyActionsUsed: number;
  minutesSinceLastAttempt: number | null;
}

const approved: PolicyDecision = { approved: true, blockReason: null, stopReason: null };
const block = (reason: string, stopReason: StopReason | null = null): PolicyDecision => ({
  approved: false,
  blockReason: reason,
  stopReason,
});

export function evaluatePolicy(input: PolicyInput): PolicyDecision {
  const { action, ctx, ev, policy, paymentState, dailyActionsUsed, minutesSinceLastAttempt } = input;

  if (!policy.allowedActions.includes(action)) {
    return block(`Action ${action} is not permitted by merchant policy.`);
  }

  // Non money-moving actions are always allowed to be recorded. They create no
  // customer contact and no Razorpay object.
  if (action === 'STOP' || action === 'NO_ACTION' || action === 'ESCALATE' || action === 'WAIT_OR_ESCALATE') {
    return approved;
  }

  // A prior confirmed success voids any customer-facing recovery action.
  if (paymentState === 'captured') {
    return block('Payment already captured; no recovery needed.', 'already_paid');
  }
  if (ctx.customer.optedOut) {
    return block('Customer has opted out of recovery contact.', 'customer_opt_out');
  }
  if (ctx.failureCategory === 'risk_blocked' && policy.stopOnSuspicious) {
    return block('Transaction flagged as suspicious; recovery blocked.', 'suspicious');
  }
  if (ctx.attempts >= policy.maxAttempts) {
    return block(`Recovery attempts exhausted (${ctx.attempts}/${policy.maxAttempts}).`, 'attempts_exhausted');
  }
  if (ctx.amount < policy.minValuePaise) {
    return block('Below minimum transaction value for recovery.', 'below_min_value');
  }
  if (ctx.amount >= policy.highValueEscalationPaise || ctx.amount > policy.maxAutonomousValuePaise) {
    return block('Value requires human escalation before contact.', 'value_requires_escalation');
  }
  if (minutesSinceLastAttempt !== null && minutesSinceLastAttempt < policy.cooldownMinutes) {
    return block(`Cooldown active (${Math.round(minutesSinceLastAttempt)} of ${policy.cooldownMinutes} min).`, 'cooldown_active');
  }
  if (dailyActionsUsed >= policy.dailyActionBudget) {
    return block('Daily recovery action budget exhausted.', 'budget_exhausted');
  }
  if (action === 'SEND_PAYMENT_LINK' && ev.expectedValuePaise <= policy.minExpectedValuePaise) {
    return block('Expected value does not justify a payment link.', 'low_expected_value');
  }

  return approved;
}
