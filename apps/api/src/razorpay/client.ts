import type { AppConfig } from '../config/env';
import { RazorpayError } from '../util/errors';
import { retry, isPreRequestConnectionError } from '../util/async';
import type { CreatePaymentLinkInput, PaymentLinkResult, RazorpayClient } from './types';

/**
 * Real Razorpay Test Mode client. Uses Basic auth with the key id and secret,
 * and the documented Payment Links endpoint. Outbound calls have a hard timeout
 * and are retried only on pre-request connection errors, so a link is never
 * created twice by an ambiguous response.
 *
 * Reference: https://razorpay.com/docs/api/payments/payment-links/create-standard/
 */
export function createHttpRazorpayClient(config: AppConfig, fetchImpl: typeof fetch = fetch): RazorpayClient {
  const auth = 'Basic ' + Buffer.from(`${config.razorpay.keyId ?? ''}:${config.razorpay.keySecret ?? ''}`).toString('base64');
  const base = config.razorpay.baseUrl.replace(/\/+$/, '');

  async function call(path: string, method: string, body?: unknown): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.razorpay.timeoutMs);
    try {
      const res = await fetchImpl(`${base}${path}`, {
        method,
        headers: { authorization: auth, 'content-type': 'application/json', accept: 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) throw new RazorpayError(`Razorpay HTTP ${res.status}: ${text.slice(0, 200)}`);
      return text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    mode: 'razorpay_test',
    async createPaymentLink(input: CreatePaymentLinkInput): Promise<PaymentLinkResult> {
      const body: Record<string, unknown> = {
        amount: input.amount,
        currency: input.currency,
        reference_id: input.referenceId,
        description: input.description,
        customer: {
          name: input.customer.name ?? undefined,
          email: input.customer.email ?? undefined,
          contact: input.customer.contact ?? undefined,
        },
        // The system controls delivery of the short url; Razorpay does not notify.
        notify: { sms: false, email: false },
        reminder_enable: false,
        notes: input.notes ?? {},
      };
      if (input.expireByUnix) body.expire_by = input.expireByUnix;
      if (input.callbackUrl) {
        body.callback_url = input.callbackUrl;
        body.callback_method = 'get';
      }
      const json = await retry(() => call('/v1/payment_links/', 'POST', body), {
        retries: 1,
        shouldRetry: isPreRequestConnectionError,
      });
      return extract(json);
    },
    async fetchPaymentLink(id: string): Promise<PaymentLinkResult> {
      const json = await call(`/v1/payment_links/${encodeURIComponent(id)}`, 'GET');
      return extract(json);
    },
  };
}

function extract(json: Record<string, unknown>): PaymentLinkResult {
  return {
    id: String(json.id ?? ''),
    shortUrl: String(json.short_url ?? ''),
    status: String(json.status ?? 'created'),
    amount: typeof json.amount === 'number' ? json.amount : Number(json.amount ?? 0),
    referenceId: json.reference_id != null ? String(json.reference_id) : null,
  };
}
