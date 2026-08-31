import { z } from 'zod';
import type { ActionType, DecisionFactor } from '../domain/types';

export const DECISION_SCHEMA_VERSION = 'decision-v1';
export const PROMPT_VERSION = 'prompt-v1';

/**
 * The model is only allowed to return an action, a short human reason, and a
 * confidence. It never returns amounts or probabilities that could be mistaken
 * for truth: those come from the deterministic engine and are the values the
 * money math and audit trail use.
 */
export const AgentDecisionSchema = z.object({
  decision: z.enum(['SEND_PAYMENT_LINK', 'RETRY_LATER', 'WAIT_OR_ESCALATE', 'ESCALATE', 'STOP', 'NO_ACTION']),
  reason: z.string().min(3).max(400),
  confidence: z.number().min(0).max(1),
});

export type RawAgentDecision = z.infer<typeof AgentDecisionSchema>;

/**
 * Structured inputs handed to the agent. Trusted facts sit alongside a single
 * `untrustedText` field which the system prompt declares to be data only. The
 * agent must pick one of `allowedActions`, which was fixed deterministically.
 */
export interface AgentInputs {
  facts: {
    amountRupees: number;
    valueTier: string;
    method: string | null;
    failureCategory: string;
    transient: boolean;
    attempts: number;
    hoursSinceFailure: number;
    isBusinessHours: boolean;
    recoveryProbability: number;
    expectedValueRupees: number;
    customer: {
      key: string;
      priorSuccesses: number;
      priorFailures: number;
      priorRecoveries: number;
      optedOut: boolean;
    };
  };
  allowedActions: ActionType[];
  factors: DecisionFactor[];
  untrustedText: string;
}
