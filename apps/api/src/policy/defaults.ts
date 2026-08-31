import type { MerchantPolicy, ActionType } from '../domain/types';

export const POLICY_VERSION = 'policy-v1';

/**
 * Sensible default recovery policy for a merchant. These are the bounds within
 * which the agent may act autonomously. Anything outside them is stopped or
 * escalated to a human, regardless of what the AI recommends.
 */
export function defaultPolicy(merchantId: string): MerchantPolicy {
  return {
    merchantId,
    version: POLICY_VERSION,
    maxAttempts: 2,
    minValuePaise: 20000, // Rs 200
    maxAutonomousValuePaise: 5000000, // Rs 50,000
    highValueEscalationPaise: 2500000, // Rs 25,000 requires human review
    cooldownMinutes: 360, // 6 hours between attempts
    maxLinkExpiryMinutes: 1440, // 24 hours
    dailyActionBudget: 500,
    allowedActions: [
      'SEND_PAYMENT_LINK',
      'RETRY_LATER',
      'WAIT_OR_ESCALATE',
      'ESCALATE',
      'STOP',
      'NO_ACTION',
    ] as ActionType[],
    stopOnSuspicious: true,
    minExpectedValuePaise: 0,
    updatedAt: new Date(),
  };
}
