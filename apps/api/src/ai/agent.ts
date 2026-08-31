import type { AppConfig } from '../config/env';
import type { CaseContext } from '../domain/context';
import type { ActionType, DecisionFactor } from '../domain/types';
import type { EvResult } from '../recovery/decision-engine';
import type { LlmProvider } from './provider';
import { AgentDecisionSchema, DECISION_SCHEMA_VERSION, PROMPT_VERSION, type AgentInputs } from './schema';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompts';
import { sanitizeUntrusted } from './sanitize';
import { rupees, clamp01 } from '../util/money';
import { withTimeout } from '../util/async';
import { toErrorInfo } from '../util/errors';

export interface AgentDecision {
  source: 'agent' | 'fallback';
  action: ActionType;
  reason: string;
  confidence: number;
  rejected: boolean;
  rejectionReason: string | null;
  injectionDetected: boolean;
  providerName: string;
  promptVersion: string;
  schemaVersion: string;
  latencyMs: number;
}

export interface AgentContext {
  ctx: CaseContext;
  ev: EvResult;
  factors: DecisionFactor[];
  allowedActions: ActionType[];
  /** Deterministic fallback used whenever the model output is unavailable or rejected. */
  recommendedAction: ActionType;
  recommendedReason: string;
}

export interface RecoveryAgent {
  decide(input: AgentContext): Promise<AgentDecision>;
}

/**
 * The recovery agent turns structured evidence into a bounded, validated action
 * choice plus a grounded explanation. Every path that could go wrong (provider
 * error, invalid JSON, schema mismatch, an action outside the allowed set) is
 * caught and converted into the deterministic fallback, so the pipeline always
 * gets a safe action. The model can only ever narrow, never widen, authority.
 */
export function createRecoveryAgent(config: AppConfig, provider: LlmProvider): RecoveryAgent {
  return {
    async decide(input: AgentContext): Promise<AgentDecision> {
      const start = Date.now();
      const sanitized = sanitizeUntrusted(input.ctx.descriptionRaw);
      const inputs = buildInputs(input, sanitized.clean);

      const fallback = (rejectionReason: string | null): AgentDecision => ({
        source: 'fallback',
        action: input.recommendedAction,
        reason: input.recommendedReason,
        confidence: 0.5,
        rejected: rejectionReason !== null,
        rejectionReason,
        injectionDetected: sanitized.injectionDetected,
        providerName: provider.name,
        promptVersion: PROMPT_VERSION,
        schemaVersion: DECISION_SCHEMA_VERSION,
        latencyMs: Date.now() - start,
      });

      let text: string;
      try {
        text = await withTimeout(
          provider.generate({
            system: SYSTEM_PROMPT,
            user: buildUserPrompt(inputs),
            timeoutMs: config.llm.timeoutMs,
            maxRetries: config.llm.maxRetries,
          }),
          config.llm.timeoutMs + 2000,
          'recovery agent',
        );
      } catch (err) {
        return fallback(`provider_error:${toErrorInfo(err).name}`);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(stripFences(text));
      } catch {
        return fallback('invalid_json');
      }

      const validated = AgentDecisionSchema.safeParse(parsed);
      if (!validated.success) return fallback('schema_invalid');

      // Boundary guard: the action must be in the deterministically allowed set.
      // This is what defeats an injected or hallucinated attempt to widen scope.
      if (!input.allowedActions.includes(validated.data.decision)) {
        return fallback(`action_not_allowed:${validated.data.decision}`);
      }

      return {
        source: 'agent',
        action: validated.data.decision,
        reason: validated.data.reason.trim(),
        confidence: clamp01(validated.data.confidence),
        rejected: false,
        rejectionReason: null,
        injectionDetected: sanitized.injectionDetected,
        providerName: provider.name,
        promptVersion: PROMPT_VERSION,
        schemaVersion: DECISION_SCHEMA_VERSION,
        latencyMs: Date.now() - start,
      };
    },
  };
}

function buildInputs(input: AgentContext, cleanText: string): AgentInputs {
  const { ctx, ev } = input;
  return {
    facts: {
      amountRupees: rupees(ctx.amount),
      valueTier: ctx.valueTier,
      method: ctx.method,
      failureCategory: ctx.failureCategory,
      transient: ctx.transient,
      attempts: ctx.attempts,
      hoursSinceFailure: Number((ctx.timeSinceFailureMinutes / 60).toFixed(1)),
      isBusinessHours: ctx.isBusinessHours,
      recoveryProbability: Number(ev.recoveryProbability.toFixed(3)),
      expectedValueRupees: Number(rupees(ev.expectedValuePaise).toFixed(2)),
      customer: {
        key: ctx.customer.customerKey,
        priorSuccesses: ctx.customer.priorSuccesses,
        priorFailures: ctx.customer.priorFailures,
        priorRecoveries: ctx.customer.priorRecoveries,
        optedOut: ctx.customer.optedOut,
      },
    },
    allowedActions: input.allowedActions,
    factors: input.factors as DecisionFactor[],
    untrustedText: cleanText,
  };
}

function stripFences(text: string): string {
  const t = text.trim();
  if (t.startsWith('```')) {
    return t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  }
  return t;
}
