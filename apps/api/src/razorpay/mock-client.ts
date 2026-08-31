import { createHash } from 'node:crypto';
import type { CreatePaymentLinkInput, PaymentLinkResult, RazorpayClient } from './types';

/**
 * Deterministic in-process Razorpay double. It creates payment link objects
 * that look like the real ones (plink_ id, short url, status) without any
 * network call. Payment outcomes are not invented here: they arrive as
 * simulated webhooks in demo and evaluation, exactly as they would from
 * Razorpay Test Mode. This keeps the mock and real paths structurally identical.
 */
export function createMockRazorpayClient(): RazorpayClient {
  const store = new Map<string, PaymentLinkResult>();

  return {
    mode: 'mock',
    async createPaymentLink(input: CreatePaymentLinkInput): Promise<PaymentLinkResult> {
      const short = createHash('sha1').update(input.referenceId).digest('hex').slice(0, 10);
      const id = `plink_mock_${short}`;
      const result: PaymentLinkResult = {
        id,
        shortUrl: `https://rzp.io/i/mock_${short}`,
        status: 'created',
        amount: input.amount,
        referenceId: input.referenceId,
      };
      store.set(id, result);
      return result;
    },
    async fetchPaymentLink(id: string): Promise<PaymentLinkResult> {
      return store.get(id) ?? { id, shortUrl: '', status: 'unknown', amount: 0, referenceId: null };
    },
  };
}
