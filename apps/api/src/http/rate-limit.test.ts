import { describe, it, expect } from 'vitest';
import { createRateLimiter } from './rate-limit';

describe('rate limiter', () => {
  it('allows up to max requests then blocks within a window', () => {
    const now = 1000;
    const rl = createRateLimiter(60000, () => now);
    for (let i = 0; i < 5; i++) {
      expect(rl.check('api:1.1.1.1', 5).ok).toBe(true);
    }
    const blocked = rl.check('api:1.1.1.1', 5);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it('resets after the window elapses', () => {
    let now = 1000;
    const rl = createRateLimiter(60000, () => now);
    for (let i = 0; i < 5; i++) rl.check('api:1.1.1.1', 5);
    expect(rl.check('api:1.1.1.1', 5).ok).toBe(false);
    now += 60001;
    expect(rl.check('api:1.1.1.1', 5).ok).toBe(true);
  });

  it('tracks different keys independently', () => {
    const now = 1000;
    const rl = createRateLimiter(60000, () => now);
    for (let i = 0; i < 5; i++) rl.check('api:1.1.1.1', 5);
    expect(rl.check('api:1.1.1.1', 5).ok).toBe(false);
    expect(rl.check('api:2.2.2.2', 5).ok).toBe(true);
  });
});
