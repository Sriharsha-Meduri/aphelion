import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Container } from '../container';
import { AppError, toErrorInfo } from '../util/errors';
import { registerHealthRoutes } from './routes/health';
import { registerWebhookRoutes } from './routes/webhook';
import { registerApiRoutes } from './routes/api';
import { registerDemoRoutes } from './routes/demo';

/**
 * The HTTP app is deliberately thin: routes validate input and hand work to the
 * pipeline. The webhook route needs the exact raw bytes to verify the Razorpay
 * signature, so a content type parser captures rawBody before JSON parsing.
 */
export function buildApp(container: Container): FastifyInstance {
  const app = Fastify({
    loggerInstance: container.logger,
    genReqId: () => randomUUID(),
    bodyLimit: 256 * 1024,
    trustProxy: true,
    requestTimeout: 20000,
  }) as unknown as FastifyInstance;

  // Keep the raw body for webhook signature verification, while still exposing parsed JSON.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    (req as unknown as { rawBody?: Buffer }).rawBody = body as Buffer;
    if (!body || (body as Buffer).length === 0) return done(null, {});
    try {
      done(null, JSON.parse((body as Buffer).toString('utf8')));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  // Minimal CORS for the local dashboard, plus security headers.
  app.addHook('onRequest', async (req, reply) => {
    reply.header('access-control-allow-origin', '*');
    reply.header('access-control-allow-methods', 'GET,POST,PUT,OPTIONS');
    reply.header('access-control-allow-headers', 'content-type,x-razorpay-signature,x-razorpay-event-id');
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    if (req.method === 'OPTIONS') {
      reply.code(204).send();
    }
  });

  registerHealthRoutes(app, container);
  registerWebhookRoutes(app, container);
  registerApiRoutes(app, container);
  registerDemoRoutes(app, container);

  app.setErrorHandler((err, req, reply) => {
    const info = err as { statusCode?: number; message?: string };
    const statusCode = typeof info.statusCode === 'number' ? info.statusCode : 500;
    req.log.error({ event: 'REQUEST_ERROR', status: statusCode, err: toErrorInfo(err) }, 'request error');
    const expose = err instanceof AppError ? err.expose : statusCode < 500;
    reply.code(statusCode).send({ error: expose ? String(info.message ?? 'error') : 'internal_error' });
  });

  app.setNotFoundHandler((_req, reply) => {
    reply.code(404).send({ error: 'not_found' });
  });

  return app;
}
