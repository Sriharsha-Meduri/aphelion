import type { Logger } from '../observability/logger';
import { toErrorInfo } from '../util/errors';
import { withTimeout } from '../util/async';

/**
 * In-process async task runner. The webhook endpoint acknowledges Razorpay
 * immediately and hands the slow work (scoring, agent, Razorpay API) to this
 * runner. It is the only place that queues work, so it can be replaced by a
 * durable queue later without touching the pipeline. drain() lets graceful
 * shutdown wait for in-flight work.
 */
export interface Processor {
  submit(task: () => Promise<void>): void;
  inFlight(): number;
  drain(timeoutMs: number): Promise<void>;
}

export function createProcessor(logger: Logger): Processor {
  const tasks = new Set<Promise<void>>();
  return {
    submit(task: () => Promise<void>): void {
      const p = (async () => {
        try {
          await task();
        } catch (err) {
          logger.error({ event: 'WORKER_TASK_FAILED', err: toErrorInfo(err) }, 'background task failed');
        }
      })();
      tasks.add(p);
      void p.finally(() => tasks.delete(p));
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
