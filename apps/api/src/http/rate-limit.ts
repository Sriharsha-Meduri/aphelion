/**
 * A small in-process fixed-window rate limiter keyed by client IP and bucket.
 * It protects the unauthenticated demo and API routes from floods and gives the
 * webhook a generous ceiling. For a single instance this is enough; a multi
 * instance deployment would move the counter to Redis behind the same interface.
 */
export interface RateDecision {
  ok: boolean;
  retryAfterMs: number;
}

export interface RateLimiter {
  check(key: string, max: number): RateDecision;
  size(): number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const MAX_KEYS = 10000;

export function createRateLimiter(windowMs: number, clock: () => number = Date.now): RateLimiter {
  const buckets = new Map<string, Bucket>();

  const sweep = (now: number): void => {
    for (const [k, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(k);
    }
  };

  return {
    check(key: string, max: number): RateDecision {
      const now = clock();
      if (buckets.size > MAX_KEYS) sweep(now);
      let b = buckets.get(key);
      if (!b || b.resetAt <= now) {
        b = { count: 0, resetAt: now + windowMs };
        buckets.set(key, b);
      }
      b.count += 1;
      if (b.count > max) return { ok: false, retryAfterMs: Math.max(0, b.resetAt - now) };
      return { ok: true, retryAfterMs: 0 };
    },
    size(): number {
      return buckets.size;
    },
  };
}
