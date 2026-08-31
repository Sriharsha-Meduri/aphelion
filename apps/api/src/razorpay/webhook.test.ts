import { describe, it, expect } from 'vitest';
import { verifySignature, parseEvent } from './webhook';
import { razorpaySignature } from '../util/hmac';

const secret = 'whsec_test';

describe('razorpay webhook', () => {
  it('accepts a valid signature over the raw body', () => {
    const body = JSON.stringify({ event: 'payment.failed' });
    const sig = razorpaySignature(body, secret);
    expect(verifySignature(body, sig, secret)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const body = JSON.stringify({ event: 'payment.failed' });
    const sig = razorpaySignature(body, secret);
    expect(verifySignature(body + ' ', sig, secret)).toBe(false);
  });

  it('rejects a wrong secret and an empty signature', () => {
    const body = 'x';
    expect(verifySignature(body, razorpaySignature(body, 'other'), secret)).toBe(false);
    expect(verifySignature(body, '', secret)).toBe(false);
  });

  it('parses a payment.failed payload', () => {
    const payload = {
      event: 'payment.failed',
      created_at: 1700000000,
      payload: {
        payment: {
          entity: {
            id: 'pay_123',
            amount: 250000,
            currency: 'INR',
            status: 'failed',
            method: 'card',
            order_id: 'order_9',
            email: 'a@b.com',
            contact: '+919876543210',
            error_code: 'BAD_REQUEST_ERROR',
            error_reason: 'insufficient_funds',
            error_source: 'customer',
            error_step: 'payment_authorization',
          },
        },
      },
    };
    const e = parseEvent(payload, 'evt_1');
    expect(e.eventType).toBe('payment.failed');
    expect(e.payment?.id).toBe('pay_123');
    expect(e.payment?.amount).toBe(250000);
    expect(e.payment?.errorReason).toBe('insufficient_funds');
    expect(e.paymentLink).toBeNull();
  });

  it('parses a payment_link.paid payload with reference id', () => {
    const payload = {
      event: 'payment_link.paid',
      payload: {
        payment_link: { entity: { id: 'plink_1', status: 'paid', amount: 250000, amount_paid: 250000, reference_id: 'rcv_abc_1' } },
        payment: { entity: { id: 'pay_ok', amount: 250000, currency: 'INR', status: 'captured' } },
      },
    };
    const e = parseEvent(payload, 'evt_2');
    expect(e.paymentLink?.referenceId).toBe('rcv_abc_1');
    expect(e.paymentLink?.amountPaid).toBe(250000);
    expect(e.payment?.status).toBe('captured');
  });
});
