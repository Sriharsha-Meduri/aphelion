import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Container } from '../../container';
import { seedDemo, runScenario, type DemoDeps } from '../../sim/demo-runner';
import { ValidationError } from '../../util/errors';

/**
 * Demo endpoints. These feed synthetic events through the real pipeline using
 * the shared demo runner (also used by the CLI scripts). In mock mode nothing
 * leaves the process; in razorpay_test mode the equivalent events arrive as
 * real signed webhooks.
 */
export function registerDemoRoutes(app: FastifyInstance, container: Container): void {
  const deps: DemoDeps = {
    pipeline: container.pipeline,
    repos: container.repos,
    config: container.config,
    razorpay: container.razorpay,
    model: container.model,
    logger: container.logger,
  };

  app.post('/demo/seed', async (req: FastifyRequest) => {
    const parsed = z.object({ count: z.number().int().min(1).max(200).optional() }).safeParse(req.body ?? {});
    if (!parsed.success) throw new ValidationError('Invalid count');
    const count = parsed.data.count ?? 40;
    const seeded = await seedDemo(deps, count);
    container.logger.info({ event: 'DEMO_SEED', count: seeded }, 'demo cases seeded');
    return { ok: true, seeded };
  });

  app.post('/demo/scenario/:name', async (req: FastifyRequest) => {
    const { name } = req.params as { name: string };
    try {
      const result = await runScenario(deps, name);
      return { ok: true, ...result };
    } catch (err) {
      throw new ValidationError(err instanceof Error ? err.message : 'Unknown scenario');
    }
  });
}
