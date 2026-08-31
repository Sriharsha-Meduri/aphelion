import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Container } from '../../container';
import { verifySignature, parseEvent } from '../../razorpay';
import { Events } from '../../observability/events';
import { correlationId as newCorrelationId, deterministicEventId } from '../../util/ids';
import { toErrorInfo } from '../../util/errors';

/**
 * Razorpay webhook ingestion. The order is strict:
 *  1. verify the HMAC signature over the raw body,
 *  2. claim the event id (unique constraint gives at-least-once idempotency),
 *  3. acknowledge with 200 immediately,
 *  4. process asynchronously in the background worker.
 * A duplicate delivery returns 200 without reprocessing.
 */
export function registerWebhookRoutes(app: FastifyInstance, container: Container): void {
  const { config, repos, processor, pipeline, logger } = container;

  app.post('/webhooks/razorpay', async (req: FastifyRequest, reply: FastifyReply) => {
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
    const signature = req.headers['x-razorpay-signature'];
    const eventIdHeader = req.headers['x-razorpay-event-id'];

    logger.info({ event: Events.WEBHOOK_RECEIVED, reqId: req.id }, 'razorpay webhook received');

    if (!raw || typeof signature !== 'string' || !verifySignature(raw, signature, config.razorpay.webhookSecret)) {
      logger.warn({ event: Events.WEBHOOK_REJECTED, reqId: req.id, reason: 'invalid_signature' }, 'signature rejected');
      return reply.code(401).send({ error: 'invalid_signature' });
    }
    logger.info({ event: Events.WEBHOOK_VERIFIED, reqId: req.id }, 'signature verified');

    const payload = (req.body ?? {}) as Record<string, unknown>;
    const providerEventId =
      typeof eventIdHeader === 'string' && eventIdHeader.length > 0
        ? eventIdHeader
        : deterministicEventId([raw.toString('utf8')]);

    const event = parseEvent(payload, providerEventId);

    const { event: claimed, created } = await repos.paymentEvents.claim({
      providerEventId,
      eventType: event.eventType,
      providerPaymentId: event.payment?.id ?? null,
      payload,
    });
    if (!created) {
      logger.info({ event: Events.WEBHOOK_DUPLICATE, providerEventId }, 'duplicate webhook ignored');
      return reply.code(200).send({ status: 'duplicate' });
    }

    const correlationId = newCorrelationId();
    processor.submit(async () => {
      try {
        await pipeline.processEvent(event, correlationId);
        await repos.paymentEvents.markProcessed(claimed.id, 'processed');
      } catch (err) {
        await repos.paymentEvents.markProcessed(claimed.id, 'failed', toErrorInfo(err).message);
      }
    });

    logger.info(
      { event: Events.WEBHOOK_ACCEPTED, providerEventId, correlationId, eventType: event.eventType },
      'accepted for processing',
    );
    return reply.code(200).send({ status: 'accepted', eventId: providerEventId, correlationId });
  });
}
