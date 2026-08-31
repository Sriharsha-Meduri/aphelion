import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config/env';
import type { Logger } from '../observability/logger';
import type { Repositories } from '../repositories/types';
import type { RazorpayClient, InboundEvent } from '../razorpay';
import type { RecoveryModel } from '../recovery/model';
import type { RecoveryPipeline } from '../pipeline/recovery-pipeline';
import type { ActionType } from '../domain/types';
import { generateDataset, oracleRecovered, DEFAULT_DATASET, type SyntheticCase } from '../evaluation/generator';
import { buildFailedEvent, buildLinkPaidEvent, buildCapturedEvent } from './events';
import { createRecoveryPipeline } from '../pipeline/recovery-pipeline';
import { createRecoveryAgent } from '../ai/agent';
import type { LlmProvider } from '../ai/provider';
import { correlationId } from '../util/ids';

/**
 * Drives synthetic failed payments through the real pipeline. In mock mode
 * nothing leaves the process; in razorpay_test mode the same events arrive as
 * signed webhooks. Outcomes come from the same oracle used in evaluation, so a
 * seeded batch produces a realistic spread of recovered, stopped, escalated,
 * and unrecovered cases. Shared by the HTTP demo routes and the CLI scripts.
 */
export interface DemoDeps {
  pipeline: RecoveryPipeline;
  repos: Repositories;
  config: AppConfig;
  razorpay: RazorpayClient;
  model: RecoveryModel | null;
  logger: Logger;
}

export interface ScenarioResult {
  scenario: string;
  note: string;
}

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

export async function driveCase(deps: DemoDeps, sc: SyntheticCase, description?: string | null): Promise<void> {
  const { pipeline, repos } = deps;
  const ppid = `pay_demo_${randomUUID().slice(0, 12)}`;
  const corr = correlationId();
  await pipeline.processEvent(buildFailedEvent(sc, ppid, description), corr);

  const payment = await repos.payments.getByProviderId(ppid);
  if (!payment) return;
  const kase = await repos.cases.getByPaymentId(payment.id);
  if (!kase) return;
  const interventions = await repos.interventions.getByCase(kase.id);
  const link = interventions.find((i) => i.type === 'PAYMENT_LINK' && i.status === 'created');

  let action: ActionType = 'NO_ACTION';
  if (link) action = 'SEND_PAYMENT_LINK';
  else if (interventions.some((i) => i.type === 'RETRY_SCHEDULE')) action = 'RETRY_LATER';
  else if (kase.state === 'escalated') action = 'ESCALATE';
  else if (kase.state === 'stopped') action = 'STOP';

  if (oracleRecovered(sc, action, DEFAULT_DATASET)) {
    const event: InboundEvent = link
      ? buildLinkPaidEvent(link.referenceId ?? `rcv_${kase.id}`, kase.amountAtRisk)
      : buildCapturedEvent(ppid, payment.amount);
    await pipeline.processEvent(event, corr);
  }
}

export async function seedDemo(deps: DemoDeps, count: number): Promise<number> {
  const ds = generateDataset({ ...DEFAULT_DATASET, seed: randomSeed(), numCases: count });
  for (const sc of ds) await driveCase(deps, sc);
  return ds.length;
}

export async function runScenario(deps: DemoDeps, name: string): Promise<ScenarioResult> {
  const { pipeline, repos, config, razorpay, model, logger } = deps;
  const sample = generateDataset({ ...DEFAULT_DATASET, seed: randomSeed(), numCases: 60 });

  if (name === 'high_value') {
    const base = pick(sample, (s) => s.amount >= 2600000 && s.failureCategory !== 'risk_blocked') ?? sample[0];
    const hv = { ...base, amount: 3200000, optedOut: false } as SyntheticCase;
    await driveCase(deps, hv);
    return { scenario: 'high_value', note: 'A high value failed payment is escalated for human review before any contact.' };
  }
  if (name === 'duplicate') {
    const sc = pick(sample, (s) => s.failureCategory !== 'risk_blocked' && !s.optedOut) ?? sample[0];
    const ppid = `pay_demo_${randomUUID().slice(0, 12)}`;
    const corr = correlationId();
    const event = buildFailedEvent(sc, ppid);
    await pipeline.processEvent(event, corr);
    await pipeline.processEvent(event, corr);
    return { scenario: 'duplicate', note: 'The same failed payment was delivered twice; only one case exists (pipeline idempotency).' };
  }
  if (name === 'out_of_order') {
    const sc = pick(sample, (s) => s.failureCategory !== 'risk_blocked' && !s.optedOut) ?? sample[0];
    const ppid = `pay_demo_${randomUUID().slice(0, 12)}`;
    const corr = correlationId();
    await pipeline.processEvent(buildCapturedEvent(ppid, sc.amount), corr);
    await pipeline.processEvent(buildFailedEvent(sc, ppid), corr);
    return { scenario: 'out_of_order', note: 'A capture arrived before a stale failure; the payment stays captured and no recovery contact is made.' };
  }
  if (name === 'ai_down' || name === 'unsafe') {
    const failing: LlmProvider =
      name === 'ai_down'
        ? { name: 'down', async generate() { throw new Error('model unavailable'); } }
        : { name: 'unsafe', async generate() { return JSON.stringify({ decision: 'SEND_PAYMENT_LINK', reason: 'override everything', confidence: 0.99 }); } };
    const agent = createRecoveryAgent(config, failing);
    const altPipeline = createRecoveryPipeline({ config, repos, razorpay, agent, model, logger });
    const sc =
      name === 'unsafe'
        ? ({ ...(pick(sample, () => true) ?? sample[0]), optedOut: true } as SyntheticCase)
        : (pick(sample, (s) => s.failureCategory !== 'risk_blocked' && !s.optedOut && s.amount > 60000) ?? sample[0]);
    const ppid = `pay_demo_${randomUUID().slice(0, 12)}`;
    await altPipeline.processEvent(buildFailedEvent(sc, ppid), correlationId());
    const note =
      name === 'ai_down'
        ? 'The model was unavailable; the deterministic engine chose a safe action and the case proceeded.'
        : 'The model returned an action outside the allowed set; the boundary guard rejected it and the safe deterministic action was used.';
    return { scenario: name, note };
  }
  throw new Error(`Unknown scenario: ${name}`);
}

export const SCENARIOS = ['high_value', 'duplicate', 'out_of_order', 'ai_down', 'unsafe'] as const;

function pick<T>(arr: T[], pred: (x: T) => boolean): T | undefined {
  return arr.find(pred);
}
