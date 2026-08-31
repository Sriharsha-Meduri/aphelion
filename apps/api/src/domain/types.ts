import type { Paise } from '../util/money';

/**
 * Domain model for revenue recovery. The persisted entities live here; the
 * transient value objects that flow through the pipeline (signals, scores,
 * decisions) live next to their producers.
 */

// --- Enumerations ------------------------------------------------------------

/** Observable payment lifecycle, aligned with Razorpay payment states. */
export type PaymentState = 'created' | 'authorized' | 'captured' | 'failed';

/** Recovery case lifecycle. */
export type CaseState =
  | 'open' // failed payment detected, case created
  | 'assessed' // risk and recovery probability computed
  | 'decided' // agent + policy selected an action
  | 'link_created' // a recovery payment link exists
  | 'attempted' // an intervention was executed
  | 'recovered' // a later successful payment was attributed
  | 'stopped' // deterministically halted (exhausted, opt-out, suspicious, low value)
  | 'escalated' // requires a human operator
  | 'no_action'; // nothing to do (already paid, not worth intervening)

/** Normalized failure categories derived deterministically from Razorpay error fields. */
export type FailureCategory =
  | 'insufficient_funds'
  | 'authentication_failed'
  | 'card_declined'
  | 'expired_instrument'
  | 'gateway_error'
  | 'bank_error'
  | 'network_timeout'
  | 'method_unsupported'
  | 'risk_blocked'
  | 'customer_dropped'
  | 'unknown';

/** Bounded action set the agent may choose from. The set is decided deterministically. */
export type ActionType =
  | 'SEND_PAYMENT_LINK'
  | 'RETRY_LATER'
  | 'WAIT_OR_ESCALATE'
  | 'ESCALATE'
  | 'STOP'
  | 'NO_ACTION';

export type InterventionType = 'PAYMENT_LINK' | 'RETRY_SCHEDULE' | 'ESCALATION';

export type InterventionStatus = 'created' | 'succeeded' | 'failed' | 'expired' | 'cancelled';

export type StopReason =
  | 'already_paid'
  | 'attempts_exhausted'
  | 'customer_opt_out'
  | 'suspicious'
  | 'low_expected_value'
  | 'cooldown_active'
  | 'budget_exhausted'
  | 'unrecoverable_failure'
  | 'below_min_value'
  | 'value_requires_escalation';

export type DecisionSource = 'agent' | 'fallback' | 'rules';

// --- Entities ----------------------------------------------------------------

export interface Merchant {
  id: string;
  name: string;
  createdAt: Date;
}

export interface Customer {
  id: string;
  merchantId: string;
  /** Anonymized key shown in UI and logs. */
  customerKey: string;
  contactHash: string;
  email: string | null;
  contact: string | null;
  optedOut: boolean;
  priorSuccesses: number;
  priorFailures: number;
  priorRecoveries: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export interface Payment {
  id: string;
  merchantId: string;
  customerId: string;
  /** Razorpay payment id (pay_xxx) or a mock id. */
  providerPaymentId: string;
  orderId: string | null;
  amount: Paise;
  currency: string;
  method: string | null;
  state: PaymentState;
  failureCategory: FailureCategory | null;
  errorCode: string | null;
  errorReason: string | null;
  errorSource: string | null;
  description: string | null;
  /** Monotonic guard: a stale event must not overwrite a newer confirmed state. */
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaymentEvent {
  id: string;
  /** Razorpay x-razorpay-event-id (unique per event). The idempotency key. */
  providerEventId: string;
  eventType: string;
  providerPaymentId: string | null;
  payload: Record<string, unknown>;
  status: 'received' | 'processing' | 'processed' | 'failed';
  errorText: string | null;
  receivedAt: Date;
  processedAt: Date | null;
}

export interface RecoveryCase {
  id: string;
  merchantId: string;
  customerId: string;
  paymentId: string;
  state: CaseState;
  amountAtRisk: Paise;
  recoveredAmount: Paise;
  attempts: number;
  stopReason: StopReason | null;
  escalated: boolean;
  correlationId: string;
  version: number;
  openedAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
}

export interface RecoveryDecision {
  id: string;
  caseId: string;
  attempt: number;
  source: DecisionSource;
  action: ActionType;
  reason: string;
  /** Deterministically computed, not taken from the model. */
  recoveryProbability: number;
  expectedValuePaise: Paise;
  confidence: number;
  /** Structured evidence factors shown as explainability (not chain-of-thought). */
  factors: DecisionFactor[];
  allowedActions: ActionType[];
  policyApproved: boolean;
  policyBlockReason: string | null;
  modelVersion: string;
  policyVersion: string;
  promptVersion: string;
  schemaVersion: string;
  createdAt: Date;
}

export interface DecisionFactor {
  label: string;
  detail: string;
  weight: number;
  direction: 'supports' | 'opposes' | 'neutral';
}

export interface RecoveryIntervention {
  id: string;
  caseId: string;
  decisionId: string;
  attempt: number;
  type: InterventionType;
  status: InterventionStatus;
  providerObjectId: string | null;
  shortUrl: string | null;
  referenceId: string | null;
  amount: Paise;
  expiresAt: Date | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

export interface AuditEvent {
  id: string;
  caseId: string | null;
  correlationId: string;
  event: string;
  actor: 'system' | 'agent' | 'policy' | 'operator';
  detail: Record<string, unknown>;
  createdAt: Date;
}

export interface MerchantPolicy {
  merchantId: string;
  version: string;
  maxAttempts: number;
  minValuePaise: Paise;
  maxAutonomousValuePaise: Paise;
  highValueEscalationPaise: Paise;
  cooldownMinutes: number;
  maxLinkExpiryMinutes: number;
  dailyActionBudget: number;
  allowedActions: ActionType[];
  stopOnSuspicious: boolean;
  minExpectedValuePaise: Paise;
  updatedAt: Date;
}

// --- Insert types ------------------------------------------------------------

export interface UpsertPaymentInput {
  merchantId: string;
  customerId: string;
  providerPaymentId: string;
  orderId: string | null;
  amount: Paise;
  currency: string;
  method: string | null;
  state: PaymentState;
  failureCategory: FailureCategory | null;
  errorCode: string | null;
  errorReason: string | null;
  errorSource: string | null;
  description: string | null;
}
