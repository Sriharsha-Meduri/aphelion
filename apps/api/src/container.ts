import { resolve } from 'node:path';
import type { AppConfig } from './config/env';
import type { Logger } from './observability/logger';
import type { Repositories } from './repositories/types';
import { buildInMemoryRepositories } from './repositories/memory';
import { buildPgRepositories } from './repositories/pg';
import { createPool } from './db/pool';
import { createRazorpayClient, type RazorpayClient } from './razorpay';
import { createLlmProvider, type LlmProvider } from './ai';
import { createRecoveryAgent, type RecoveryAgent } from './ai/agent';
import { loadModel, type RecoveryModel } from './recovery/model';
import { createRecoveryPipeline, type RecoveryPipeline } from './pipeline/recovery-pipeline';
import { createProcessor, type Processor } from './workers/processor';

export const MODEL_PATH = resolve(process.cwd(), 'models', 'recovery-model.json');

export interface ContainerOverrides {
  repos?: Repositories;
  razorpay?: RazorpayClient;
  provider?: LlmProvider;
  agent?: RecoveryAgent;
  model?: RecoveryModel | null;
}

export interface Container {
  config: AppConfig;
  logger: Logger;
  repos: Repositories;
  razorpay: RazorpayClient;
  agent: RecoveryAgent;
  model: RecoveryModel | null;
  pipeline: RecoveryPipeline;
  processor: Processor;
  shutdown(drainMs?: number): Promise<void>;
}

export function createContainer(config: AppConfig, logger: Logger, overrides: ContainerOverrides = {}): Container {
  const repos =
    overrides.repos ??
    (config.db.driver === 'memory' ? buildInMemoryRepositories() : buildPgRepositories(createPool(config)));
  const razorpay = overrides.razorpay ?? createRazorpayClient(config);
  const provider = overrides.provider ?? createLlmProvider(config);
  const model = overrides.model !== undefined ? overrides.model : loadModel(MODEL_PATH);
  const agent = overrides.agent ?? createRecoveryAgent(config, provider);
  const pipeline = createRecoveryPipeline({ config, repos, razorpay, agent, model, logger });
  const processor = createProcessor(logger);

  return {
    config,
    logger,
    repos,
    razorpay,
    agent,
    model,
    pipeline,
    processor,
    async shutdown(drainMs = 60000): Promise<void> {
      await processor.drain(drainMs);
      await repos.close();
    },
  };
}
