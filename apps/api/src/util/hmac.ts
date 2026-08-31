import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Razorpay webhook signatures: HMAC-SHA256 of the RAW request body keyed by the
 * webhook secret, hex encoded, delivered in the X-Razorpay-Signature header.
 * The body must be the exact bytes received (never re-serialized), so the HTTP
 * layer captures the raw buffer before any JSON parsing.
 *
 * Reference: https://razorpay.com/docs/webhooks/validate-test/
 */
export function razorpaySignature(rawBody: string | Buffer, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

export function verifyRazorpaySignature(rawBody: string | Buffer, signature: string, secret: string): boolean {
  if (!signature) return false;
  const expected = razorpaySignature(rawBody, secret);
  return timingSafeEqualHex(expected, signature);
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
