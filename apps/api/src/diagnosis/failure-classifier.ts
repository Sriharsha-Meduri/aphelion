import type { FailureCategory } from '../domain/types';

export interface FailureDiagnosis {
  category: FailureCategory;
  /** True when the failure looks temporary and a simple retry could succeed. */
  transient: boolean;
  /** True when the failure carries fraud or risk signals; blocks autonomous recovery. */
  suspicious: boolean;
  /**
   * Heuristic prior probability that a recovery nudge converts, given only the
   * failure type. The calibrated model refines this using the full context.
   */
  baseRecoverability: number;
  note: string;
}

interface Rule {
  category: FailureCategory;
  transient: boolean;
  suspicious: boolean;
  baseRecoverability: number;
  note: string;
  match: (haystack: string) => boolean;
}

const has = (...needles: string[]) => (h: string) => needles.some((n) => h.includes(n));

/**
 * Deterministic mapping from Razorpay error fields to a normalized failure
 * category. Order matters: the first matching rule wins, so risk and hard
 * declines are checked before softer, recoverable categories.
 * Reference: https://razorpay.com/docs/errors/
 */
const RULES: Rule[] = [
  {
    category: 'risk_blocked',
    transient: false,
    suspicious: true,
    baseRecoverability: 0.05,
    note: 'Blocked for risk or fraud checks; not eligible for autonomous recovery.',
    match: has('fraud', 'risk', 'blocked', 'suspicious', 'velocity', 'blacklist'),
  },
  {
    category: 'insufficient_funds',
    transient: false,
    suspicious: false,
    baseRecoverability: 0.55,
    note: 'Insufficient balance; often converts once the customer tops up.',
    match: has('insufficient', 'low_balance', 'not_enough'),
  },
  {
    category: 'authentication_failed',
    transient: true,
    suspicious: false,
    baseRecoverability: 0.5,
    note: 'OTP or 3DS authentication dropped; a fresh attempt frequently succeeds.',
    match: has('authentication', '3ds', 'otp', 'not_authenticated', 'auth_'),
  },
  {
    category: 'expired_instrument',
    transient: false,
    suspicious: false,
    baseRecoverability: 0.32,
    note: 'Card or instrument expired; a link lets the customer use another method.',
    match: has('expired', 'card_expired'),
  },
  {
    category: 'card_declined',
    transient: false,
    suspicious: false,
    baseRecoverability: 0.35,
    note: 'Issuer declined the card; moderate recovery via retry or alternate method.',
    match: has('declined', 'do_not_honour', 'do_not_honor', 'issuer', 'card_not_allowed', 'international'),
  },
  {
    category: 'method_unsupported',
    transient: false,
    suspicious: false,
    baseRecoverability: 0.45,
    note: 'Method not supported; a payment link exposes alternate methods.',
    match: has('not_supported', 'unsupported', 'method_not', 'invalid_method'),
  },
  {
    category: 'network_timeout',
    transient: true,
    suspicious: false,
    baseRecoverability: 0.65,
    note: 'Network or timeout error; usually resolves on retry.',
    match: has('timeout', 'timed_out', 'network', 'no_response'),
  },
  {
    category: 'gateway_error',
    transient: true,
    suspicious: false,
    baseRecoverability: 0.6,
    note: 'Gateway side error; typically transient.',
    match: has('gateway', 'server_error', 'service_unavailable', 'temporarily'),
  },
  {
    category: 'bank_error',
    transient: true,
    suspicious: false,
    baseRecoverability: 0.55,
    note: 'Bank side error; often transient.',
    match: has('bank', 'acquirer', 'switch'),
  },
  {
    category: 'customer_dropped',
    transient: false,
    suspicious: false,
    baseRecoverability: 0.5,
    note: 'Customer abandoned the flow; a timely reminder link helps.',
    match: has('cancelled', 'canceled', 'abandoned', 'closed_by_user', 'user_'),
  },
];

/**
 * Classify a failure from its Razorpay error fields plus the payment method.
 * Missing fields are tolerated. Everything unmatched becomes `unknown` with a
 * moderate prior, so the system stays useful even on novel error strings.
 */
export function classifyFailure(input: {
  errorCode?: string | null;
  errorReason?: string | null;
  errorSource?: string | null;
  errorStep?: string | null;
  method?: string | null;
}): FailureDiagnosis {
  const haystack = [input.errorCode, input.errorReason, input.errorSource, input.errorStep, input.method]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  for (const rule of RULES) {
    if (rule.match(haystack)) {
      return {
        category: rule.category,
        transient: rule.transient,
        suspicious: rule.suspicious,
        baseRecoverability: rule.baseRecoverability,
        note: rule.note,
      };
    }
  }
  return {
    category: 'unknown',
    transient: false,
    suspicious: false,
    baseRecoverability: 0.35,
    note: 'Unclassified failure; treated with a moderate recovery prior.',
  };
}
