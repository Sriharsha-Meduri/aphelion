import { Pool, type PoolConfig } from 'pg';
import type { AppConfig } from '../config/env';

export function resolveSsl(url: string, mode: 'auto' | 'require' | 'disable'): PoolConfig['ssl'] {
  if (mode === 'disable') return false;
  if (mode === 'require') return { rejectUnauthorized: false };
  try {
    const host = new URL(url).hostname;
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    return isLocal ? false : { rejectUnauthorized: false };
  } catch {
    return { rejectUnauthorized: false };
  }
}

export function createPool(config: AppConfig): Pool {
  if (!config.db.url) throw new Error('createPool called without DATABASE_URL');
  return new Pool({
    connectionString: config.db.url,
    max: config.db.poolMax,
    ssl: resolveSsl(config.db.url, config.db.ssl),
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    statement_timeout: 20000,
    query_timeout: 20000,
  });
}
