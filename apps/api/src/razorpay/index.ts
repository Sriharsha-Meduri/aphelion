import type { AppConfig } from '../config/env';
import { createMockRazorpayClient } from './mock-client';
import { createHttpRazorpayClient } from './client';
import type { RazorpayClient } from './types';

export type {
  RazorpayClient,
  CreatePaymentLinkInput,
  PaymentLinkResult,
  InboundEvent,
  NormalizedPayment,
  NormalizedPaymentLink,
} from './types';
export { verifySignature, parseEvent } from './webhook';

export function createRazorpayClient(config: AppConfig, fetchImpl?: typeof fetch): RazorpayClient {
  return config.razorpay.mode === 'razorpay_test'
    ? createHttpRazorpayClient(config, fetchImpl)
    : createMockRazorpayClient();
}
