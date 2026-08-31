import { verifyRazorpaySignature } from '../util/hmac';
import type { InboundEvent, NormalizedPayment, NormalizedPaymentLink } from './types';

/**
 * Verify and parse a Razorpay webhook. Verification uses the raw request body
 * (never re-serialized) against the webhook secret. Parsing is defensive: it
 * extracts the documented entity paths but tolerates missing fields, so a
 * slightly different payload shape degrades rather than throws.
 *
 * Reference:
 *  - Signature: https://razorpay.com/docs/webhooks/validate-test/
 *  - Payloads:  https://razorpay.com/docs/webhooks/payloads/payments/
 */
export function verifySignature(rawBody: string | Buffer, signature: string, secret: string): boolean {
  return verifyRazorpaySignature(rawBody, signature, secret);
}

export function parseEvent(payload: Record<string, unknown>, providerEventId: string): InboundEvent {
  const eventType = str(payload.event) ?? 'unknown';
  const createdAt = int(payload.created_at) ?? Math.floor(Date.now() / 1000);
  const paymentEntity = entity(payload, 'payment');
  const linkEntity = entity(payload, 'payment_link');
  return {
    providerEventId,
    eventType,
    createdAt,
    payment: paymentEntity ? parsePayment(paymentEntity) : null,
    paymentLink: linkEntity ? parsePaymentLink(linkEntity) : null,
    raw: payload,
  };
}

function parsePayment(e: Record<string, unknown>): NormalizedPayment {
  const error = obj(e.error) ?? {};
  const notes = obj(e.notes) ?? {};
  return {
    id: str(e.id) ?? '',
    orderId: str(e.order_id),
    amount: int(e.amount) ?? 0,
    currency: str(e.currency) ?? 'INR',
    status: str(e.status) ?? 'unknown',
    method: str(e.method),
    email: str(e.email),
    contact: str(e.contact),
    errorCode: str(e.error_code) ?? str(error.code),
    errorReason: str(e.error_reason) ?? str(error.reason),
    errorSource: str(e.error_source) ?? str(error.source),
    errorStep: str(e.error_step) ?? str(error.step),
    description: str(e.description),
    referenceId: str(notes.reference_id) ?? str(e.reference_id),
  };
}

function parsePaymentLink(e: Record<string, unknown>): NormalizedPaymentLink {
  return {
    id: str(e.id) ?? '',
    status: str(e.status) ?? 'unknown',
    amount: int(e.amount) ?? 0,
    amountPaid: int(e.amount_paid) ?? 0,
    referenceId: str(e.reference_id),
  };
}

// --- Safe accessors ---------------------------------------------------------

function entity(payload: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const p = obj(payload.payload);
  const wrapped = p ? obj(p[key]) : null;
  return wrapped ? obj(wrapped.entity) : null;
}
function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s.length > 0 ? s : null;
}
function int(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }
  return null;
}
