import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Container } from '../../container';
import { withTimeout } from '../../util/async';

export function registerHealthRoutes(app: FastifyInstance, container: Container): void {
  app.get('/health', async () => ({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    razorpayMode: container.config.razorpay.mode,
    llmProvider: container.config.llm.provider,
    model: container.model ? container.model.version : 'heuristic-prior-v1',
  }));

  const ready = async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      await withTimeout(container.repos.ping(), 3000, 'db ping');
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'not_ready' });
    }
  };
  app.get('/ready', ready);
}
