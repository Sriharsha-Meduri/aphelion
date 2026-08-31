import type { Paise, ValueTier } from '../util/money';
import type { FailureCategory } from './types';

/**
 * CaseContext is the structured, deterministic evidence assembled for one
 * recovery decision. Every field is a known fact at decision time (no future
 * leakage). This object, minus untrusted free text, is what the scorer, the EV
 * engine, the policy gate, and the AI agent all read. The AI receives it as
 * data, never as authority.
 */
export interface CustomerContext {
  customerKey: string;
  priorSuccesses: number;
  priorFailures: number;
  priorRecoveries: number;
  optedOut: boolean;
  ageDays: number;
  recencyDays: number;
}

export interface CaseContext {
  caseId: string;
  correlationId: string;
  merchantId: string;
  amount: Paise;
  currency: string;
  valueTier: ValueTier;
  method: string | null;
  failureCategory: FailureCategory;
  transient: boolean;
  baseRecoverability: number;
  errorCode: string | null;
  errorReason: string | null;
  errorSource: string | null;
  /** Prior recovery attempts already made on this case. */
  attempts: number;
  timeSinceFailureMinutes: number;
  hourOfDay: number;
  isBusinessHours: boolean;
  customer: CustomerContext;
  /** Customer or merchant supplied free text. Treated as untrusted data. */
  descriptionRaw: string | null;
}
