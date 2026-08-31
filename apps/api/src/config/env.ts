/**
 * Configuration is loaded once at boot and validated. A bad or missing value
 * fails fast with a clear message rather than surfacing later at request time.
 *
 * Secrets (Razorpay keys, LLM keys) come from the environment only. They are
 * never logged and never returned through the API.
 */

export type NodeEnv = 'development' | 'test' | 'production';
export type DbDriver = 'postgres' | 'memory';
export type RazorpayMode = 'mock' | 'razorpay_test';
export type LlmProvider = 'mock' | 'gemini';
export type SslMode = 'auto' | 'require' | 'disable';

export interface AppConfig {
  env: NodeEnv;
  port: number;
  host: string;
  log: { level: string; pretty: boolean; redactContent: boolean };
  db: { driver: DbDriver; url?: string; ssl: SslMode; poolMax: number; migrationsDir: string };
  razorpay: {
    mode: RazorpayMode;
    keyId?: string;
    keySecret?: string;
    webhookSecret: string;
    baseUrl: string;
    timeoutMs: number;
    linkExpiryDefaultMinutes: number;
  };
  llm: {
    provider: LlmProvider;
    apiKey?: string;
    model: string;
    timeoutMs: number;
    maxRetries: number;
    maxTokens: number;
    thinkingBudget: number;
  };
  economics: {
    /** Cost booked per intervention (paise). Sending a link is not free: SMS/email + ops. */
    interventionCostPaise: number;
    /** Multiplier applied to amount when a case is flagged suspicious, to discourage action. */
    riskCostFactor: number;
    /** Baseline probability a customer self-recovers with no intervention (used by the EV net-of-baseline calc). */
    baselineSelfRecovery: number;
  };
}

type Env = Record<string, string | undefined>;

const str = (v: string | undefined): string | undefined => {
  const t = v?.trim();
  return t ? t : undefined;
};
const bool = (v: string | undefined, def: boolean): boolean => {
  const t = str(v)?.toLowerCase();
  if (t === undefined) return def;
  return t === 'true' || t === '1' || t === 'yes' || t === 'on';
};
const int = (v: string | undefined, def: number): number => {
  const t = str(v);
  if (t === undefined) return def;
  const n = Number(t);
  return Number.isFinite(n) ? Math.trunc(n) : def;
};
const num = (v: string | undefined, def: number): number => {
  const t = str(v);
  if (t === undefined) return def;
  const n = Number(t);
  return Number.isFinite(n) ? n : def;
};
const oneOf = <T extends string>(v: string | undefined, allowed: readonly T[], def: T): T => {
  const t = str(v)?.toLowerCase();
  return (allowed as readonly string[]).includes(t ?? '') ? (t as T) : def;
};

export class ConfigError extends Error {}

export function loadConfig(env: Env = process.env): AppConfig {
  const errors: string[] = [];
  const nodeEnv = oneOf<NodeEnv>(env.NODE_ENV, ['development', 'test', 'production'], 'development');
  const dbDriver = oneOf<DbDriver>(env.DB_DRIVER, ['postgres', 'memory'], 'postgres');
  const razorpayMode = oneOf<RazorpayMode>(env.RAZORPAY_MODE, ['mock', 'razorpay_test'], 'mock');
  const llmProvider = oneOf<LlmProvider>(env.LLM_PROVIDER, ['mock', 'gemini'], 'mock');

  const config: AppConfig = {
    env: nodeEnv,
    port: int(env.PORT, 4000),
    host: str(env.HOST) ?? '0.0.0.0',
    log: {
      level: oneOf(env.LOG_LEVEL, ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'], 'info'),
      pretty: bool(env.LOG_PRETTY, nodeEnv === 'development'),
      redactContent: bool(env.LOG_REDACT_CONTENT, true),
    },
    db: {
      driver: dbDriver,
      url: str(env.DATABASE_URL),
      ssl: oneOf<SslMode>(env.DATABASE_SSL, ['auto', 'require', 'disable'], 'auto'),
      poolMax: int(env.DATABASE_POOL_MAX, 10),
      migrationsDir: str(env.MIGRATIONS_DIR) ?? 'migrations',
    },
    razorpay: {
      mode: razorpayMode,
      keyId: str(env.RAZORPAY_KEY_ID),
      keySecret: str(env.RAZORPAY_KEY_SECRET),
      // Falls back to a fixed dev secret so mock-mode signature tests are deterministic.
      webhookSecret: str(env.RAZORPAY_WEBHOOK_SECRET) ?? 'whsec_dev_only_not_a_real_secret',
      baseUrl: str(env.RAZORPAY_BASE_URL) ?? 'https://api.razorpay.com',
      timeoutMs: int(env.RAZORPAY_TIMEOUT_MS, 15000),
      linkExpiryDefaultMinutes: int(env.RAZORPAY_LINK_EXPIRY_MINUTES, 1440),
    },
    llm: {
      provider: llmProvider,
      apiKey: str(env.GEMINI_API_KEY) ?? str(env.GOOGLE_API_KEY),
      model: str(env.LLM_MODEL) ?? 'gemini-2.5-flash',
      timeoutMs: int(env.LLM_TIMEOUT_MS, 12000),
      maxRetries: int(env.LLM_MAX_RETRIES, 1),
      maxTokens: int(env.LLM_MAX_TOKENS, 700),
      thinkingBudget: int(env.LLM_THINKING_BUDGET, 0),
    },
    economics: {
      interventionCostPaise: int(env.INTERVENTION_COST_PAISE, 300),
      riskCostFactor: num(env.RISK_COST_FACTOR, 0.5),
      baselineSelfRecovery: num(env.BASELINE_SELF_RECOVERY, 0.08),
    },
  };

  if (config.db.driver === 'postgres' && !config.db.url) {
    errors.push('DATABASE_URL is required when DB_DRIVER=postgres (or set DB_DRIVER=memory for tests/demo).');
  }
  if (config.razorpay.mode === 'razorpay_test') {
    if (!config.razorpay.keyId) errors.push('RAZORPAY_KEY_ID is required when RAZORPAY_MODE=razorpay_test.');
    if (!config.razorpay.keySecret) errors.push('RAZORPAY_KEY_SECRET is required when RAZORPAY_MODE=razorpay_test.');
  }
  if (config.llm.provider === 'gemini' && !config.llm.apiKey) {
    errors.push('GEMINI_API_KEY is required when LLM_PROVIDER=gemini (or set LLM_PROVIDER=mock).');
  }
  if (config.env === 'production' && config.razorpay.webhookSecret.startsWith('whsec_dev_only')) {
    errors.push('RAZORPAY_WEBHOOK_SECRET must be set in production.');
  }

  if (errors.length > 0) {
    throw new ConfigError(`Invalid configuration:\n  - ${errors.join('\n  - ')}`);
  }
  return config;
}
