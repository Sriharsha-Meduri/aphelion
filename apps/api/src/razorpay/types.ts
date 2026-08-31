import type { Paise } from '../util/money';

/** Normalized view of a Razorpay payment entity (payload.payment.entity). */
export interface NormalizedPayment {
  id: string;
  orderId: string | null;
  amount: Paise;
  currency: string;
  status: string;
  method: string | null;
  email: string | null;
  contact: string | null;
  errorCode: string | null;
  errorReason: string | null;
  errorSource: string | null;
  errorStep: string | null;
  description: string | null;
  referenceId: string | null;
}

/** Normalized view of a Razorpay payment link entity (payload.payment_link.entity). */
export interface NormalizedPaymentLink {
  id: string;
  status: string;
  amount: Paise;
  amountPaid: Paise;
  referenceId: string | null;
}

export interface InboundEvent {
  providerEventId: string;
  eventType: string;
  createdAt: number;
  payment: NormalizedPayment | null;
  paymentLink: NormalizedPaymentLink | null;
  raw: Record<string, unknown>;
}

export interface CreatePaymentLinkInput {
  amount: Paise;
  currency: string;
  referenceId: string;
  description: string;
  customer: { name?: string | null; email?: string | null; contact?: string | null };
  expireByUnix?: number;
  notes?: Record<string, string>;
  callbackUrl?: string;
}

export interface PaymentLinkResult {
  id: string;
  shortUrl: string;
  status: string;
  amount: Paise;
  referenceId: string | null;
}

export interface RazorpayClient {
  readonly mode: 'mock' | 'razorpay_test';
  createPaymentLink(input: CreatePaymentLinkInput): Promise<PaymentLinkResult>;
  fetchPaymentLink(id: string): Promise<PaymentLinkResult>;
}
