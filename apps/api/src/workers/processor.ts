import type { Logger } from '../observability/logger';
import { toErrorInfo } from '../util/errors';
import { withTimeout } from '../util/async';

/**
 * In-process async task runner. The webhook endpoint acknowledges Razorpay
 * immediately and hands the slow work (scoring, agent, Razorpay API) to this
 * runner. It is the only place that queues work, so it can be replaced by a
 * durable queue later without touching the pipeline. drain() lets graceful
 * shutdown wait for in-flight work.
 *
 * Tasks submitted with the same key run strictly in order (chained), so all
 * events for one payment are processed sequentially and cannot interleave their
 * read-modify-write on the case. Tasks with no key run concurrently.
 */
export interface Processor {
  submit(task: () => Promise<void>, key?: string): void;
  inFlight(): number;
  drain(timeoutMs: number): Promise<void>;
}

export function createProcessor(logger: Logger): Processor {
  const tasks = new Set<Promise<void>>();
  const tails = new Map<string, Promise<void>>();

  const track = (p: Promise<void>): void => {
    tasks.add(p);
    void p.finally(() => tasks.delete(p));
  };

  const guarded = (task: () => Promise<void>) => async (): Promise<void> => {
    try {
      await task();
    } catch (err) {
      logger.error({ event: 'WORKER_TASK_FAILED', err: toErrorInfo(err) }, 'background task failed');
    }
  };

  return {
    submit(task: () => Promise<void>, key?: string): void {
      const run = guarded(task);
      if (!key) {
        track(run());
        return;
      }
      // Chain after the current tail for this key so same-key work is serialized.
      // A prior task failing must not break the chain, so its error is swallowed here.
      const prev = tails.get(key) ?? Promise.resolve();
      const next = prev.then(run, run);
      tails.set(key, next);
      track(next);
      void next.finally(() => {
        if (tails.get(key) === next) tails.delete(key);
      });
    },
    inFlight(): number {
      return tasks.size;
    },
    async drain(timeoutMs: number): Promise<void> {
      if (tasks.size === 0) return;
      await withTimeout(Promise.allSettled([...tasks]).then(() => undefined), timeoutMs, 'processor drain').catch(() => {
        logger.warn({ event: 'WORKER_DRAIN_TIMEOUT', inFlight: tasks.size }, 'drain timed out');
      });
    },
  };
}
