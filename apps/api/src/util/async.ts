/** Small async primitives: sleep, timeout, and a bounded retry with backoff. */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TimeoutError extends Error {
  constructor(message = 'Operation timed out') {
    super(message);
    this.name = 'TimeoutError';
  }
}

/** Reject with TimeoutError if `promise` does not settle within `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = 'operation'): Promise<T> {
  if (!ms || ms <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export interface RetryOptions {
  retries: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

export async function retry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const { retries, baseDelayMs = 200, maxDelayMs = 2000, shouldRetry, onRetry } = opts;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt > retries || (shouldRetry && !shouldRetry(err, attempt))) throw err;
      const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const jitter = (attempt % 3) * 40;
      onRetry?.(err, attempt, exp + jitter);
      await sleep(exp + jitter);
    }
  }
}

/**
 * True only for errors that occurred before the request reached the peer
 * (DNS/connect failures). These are the only outbound failures safe to retry
 * without risking a duplicate side effect, such as a duplicate payment link.
 */
export function isPreRequestConnectionError(err: unknown): boolean {
  const code = (err as { code?: string } | undefined)?.code;
  const cause = (err as { cause?: { code?: string } } | undefined)?.cause?.code;
  const connect = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH']);
  return (!!code && connect.has(code)) || (!!cause && connect.has(cause));
}
