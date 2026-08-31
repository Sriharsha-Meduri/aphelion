import type { AppConfig } from '../config/env';
import { createLogger, type Logger } from '../observability/logger';
import { createContainer, type Container, type ContainerOverrides } from '../container';

export function makeTestConfig(): AppConfig {
  return {
    env: 'test',
    port: 0,
    host: '127.0.0.1',
    log: { level: 'silent', pretty: false, redactContent: true },
    db: { driver: 'memory', url: undefined, ssl: 'disable', poolMax: 1, migrationsDir: 'migrations' },
    razorpay: {
      mode: 'mock',
      keyId: undefined,
      keySecret: undefined,
      webhookSecret: 'whsec_test_secret',
      baseUrl: 'https://api.razorpay.com',
      timeoutMs: 5000,
      linkExpiryDefaultMinutes: 1440,
    },
    llm: { provider: 'mock', apiKey: undefined, model: 'mock', timeoutMs: 5000, maxRetries: 0, maxTokens: 500, thinkingBudget: 0 },
    economics: { interventionCostPaise: 300, riskCostFactor: 0.5, baselineSelfRecovery: 0.08 },
  };
}

export function silentLogger(): Logger {
  return createLogger(makeTestConfig());
}

export function testContainer(overrides: ContainerOverrides = {}): Container {
  // Model defaults to null (heuristic) in tests unless overridden, so tests do not
  // depend on a trained model file being present.
  return createContainer(makeTestConfig(), silentLogger(), { model: null, ...overrides });
}
