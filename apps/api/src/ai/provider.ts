import type { ActionType } from '../domain/types';
import type { AgentInputs } from './schema';
import { clamp01 } from '../util/money';

export interface LlmRequest {
  system: string;
  user: string;
  timeoutMs: number;
  maxRetries: number;
}

export interface LlmProvider {
  readonly name: string;
  generate(req: LlmRequest): Promise<string>;
}

/**
 * Deterministic mock agent. It behaves like a well-aligned model: it reads the
 * structured inputs, picks one of the allowed actions, and writes a grounded
 * reason. It never picks outside the allowed set, so the whole product works
 * with no API key, and evaluation and tests stay reproducible.
 */
export function createMockProvider(): LlmProvider {
  return {
    name: 'mock',
    async generate(req: LlmRequest): Promise<string> {
      const inputs = JSON.parse(req.user) as AgentInputs;
      const decision = chooseAction(inputs);
      const reason = buildReason(inputs, decision);
      const confidence = clamp01(0.55 + inputs.facts.recoveryProbability * 0.4);
      return JSON.stringify({ decision, reason, confidence: Number(confidence.toFixed(2)) });
    },
  };
}

function chooseAction(inputs: AgentInputs): ActionType {
  const a = inputs.allowedActions;
  const includes = (x: ActionType) => a.includes(x);
  const evPositive = inputs.facts.expectedValueRupees > 0;

  if (includes('SEND_PAYMENT_LINK') && evPositive) return 'SEND_PAYMENT_LINK';
  if (!evPositive && includes('NO_ACTION')) return 'NO_ACTION';
  if (includes('RETRY_LATER') && inputs.facts.transient) return 'RETRY_LATER';
  if (includes('ESCALATE')) return 'ESCALATE';
  if (includes('WAIT_OR_ESCALATE')) return 'WAIT_OR_ESCALATE';
  if (includes('SEND_PAYMENT_LINK') && evPositive) return 'SEND_PAYMENT_LINK';
  if (includes('RETRY_LATER')) return 'RETRY_LATER';
  if (includes('NO_ACTION')) return 'NO_ACTION';
  if (includes('STOP')) return 'STOP';
  return a[0] ?? 'NO_ACTION';
}

function buildReason(inputs: AgentInputs, decision: ActionType): string {
  const f = inputs.facts;
  const top = [...inputs.factors].filter((x) => x.direction !== 'neutral').sort((x, y) => y.weight - x.weight)[0];
  const support = top ? top.detail.toLowerCase() : `failure type ${f.failureCategory}`;
  switch (decision) {
    case 'SEND_PAYMENT_LINK':
      return `Recoverable ${f.failureCategory} failure with ${support} and positive expected value, so a payment link is worthwhile.`;
    case 'RETRY_LATER':
      return `Transient ${f.failureCategory} failure on attempt ${f.attempts + 1}; a scheduled retry is low cost before contacting the customer.`;
    case 'ESCALATE':
      return `High value transaction requires human review before any customer contact.`;
    case 'WAIT_OR_ESCALATE':
      return `A prior attempt did not convert; wait and escalate to a human rather than contacting again immediately.`;
    case 'STOP':
      return `Stopping recovery based on ${support}.`;
    case 'NO_ACTION':
    default:
      return `No action is justified given ${support}.`;
  }
}
