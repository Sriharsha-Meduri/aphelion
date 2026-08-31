import { describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { testContainer } from '../test/helpers';
import type { Container } from '../container';
import { razorpaySignature } from '../util/hmac';

function make(): { app: FastifyInstance; container: Container } {
  const container = testContainer();
  return { app: buildApp(container), container };
}

function failedPayload(id: string, eventId: string): string {
  return JSON.stringify({
    event: 'payment.failed',
    created_at: Math.floor(Date.now() / 1000),
    payload: {
      payment: {
        entity: {
          id,
          amount: 250000,
          currency: 'INR',
          status: 'failed',
          method: 'card',
          order_id: `order_${id}`,
          email: 'buyer@example.test',
          contact: '+919812345678',
          error_reason: 'card_declined_by_issuer',
          error_source: 'bank',
          error_step: 'payment_authorization',
        },
      },
    },
    _eventId: eventId,
  });
}

const secret = 'whsec_test_secret';

describe('POST /webhooks/razorpay (e2e)', () => {
  it('rejects a request with an invalid signature', async () => {
    const { app } = make();
    const body = failedPayload('pay_e1', 'evt_e1');
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/razorpay',
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': 'deadbeef', 'x-razorpay-event-id': 'evt_e1' },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('accepts a valid signature, processes it, and opens a recovery case', async () => {
    const { app, container } = make();
    const body = failedPayload('pay_e2', 'evt_e2');
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/razorpay',
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': razorpaySignature(body, secret), 'x-razorpay-event-id': 'evt_e2' },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'accepted' });

    await container.processor.drain(5000);
    const payment = await container.repos.payments.getByProviderId('pay_e2');
    expect(payment).not.toBeNull();
    const kase = await container.repos.cases.getByPaymentId(payment!.id);
    expect(kase).not.toBeNull();
    await app.close();
  });

  it('is idempotent on a duplicate event id', async () => {
    const { app, container } = make();
    const body = failedPayload('pay_e3', 'evt_e3');
    const headers = { 'content-type': 'application/json', 'x-razorpay-signature': razorpaySignature(body, secret), 'x-razorpay-event-id': 'evt_e3' };

    const first = await app.inject({ method: 'POST', url: '/webhooks/razorpay', headers, payload: body });
    expect(first.json()).toMatchObject({ status: 'accepted' });
    await container.processor.drain(5000);

    const second = await app.inject({ method: 'POST', url: '/webhooks/razorpay', headers, payload: body });
    expect(second.json()).toMatchObject({ status: 'duplicate' });
    await container.processor.drain(5000);

    const cases = await container.repos.cases.list({ limit: 100 });
    expect(cases).toHaveLength(1);
    await app.close();
  });

  it('health endpoint reports mode and model', async () => {
    const { app } = make();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', razorpayMode: 'mock' });
    await app.close();
  });
});
