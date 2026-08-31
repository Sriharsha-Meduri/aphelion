import type { InboundEvent, NormalizedPayment } from '../razorpay';
import type { SyntheticCase } from '../evaluation/generator';

/**
 * Builders for Razorpay-shaped inbound events used by the demo. In demo mode
 * these are fed to the same pipeline the real webhook uses, so the full loop is
 * exercised without any live Razorpay call. In razorpay_test mode the same
 * events arrive as real signed webhooks instead.
 */
function fakeContact(customerId: string): string {
  const digits = customerId.replace(/\D/g, '').slice(-8).padStart(8, '9');
  return `+9190${digits}`;
}

export function buildFailedEvent(sc: SyntheticCase, providerPaymentId: string, description?: string | null): InboundEvent {
  const payment: NormalizedPayment = {
    id: providerPaymentId,
    orderId: `order_${providerPaymentId}`,
    amount: sc.amount,
    currency: 'INR',
    status: 'failed',
    method: sc.method,
    email: `${sc.customerId}@example.test`,
    contact: fakeContact(sc.customerId),
    errorCode: sc.errorCode,
    errorReason: sc.errorReason,
    errorSource: sc.errorSource,
    errorStep: sc.errorStep,
    description: description ?? sc.descriptionRaw,
    referenceId: null,
  };
  return {
    providerEventId: `evt_fail_${providerPaymentId}`,
    eventType: 'payment.failed',
    createdAt: Math.floor(Date.now() / 1000),
    payment,
    paymentLink: null,
    raw: {},
  };
}

export function buildLinkPaidEvent(referenceId: string, amount: number): InboundEvent {
  return {
    providerEventId: `evt_paid_${referenceId}`,
    eventType: 'payment_link.paid',
    createdAt: Math.floor(Date.now() / 1000),
    payment: {
      id: `pay_rcv_${referenceId}`,
      orderId: null,
      amount,
      currency: 'INR',
      status: 'captured',
      method: 'upi',
      email: null,
      contact: null,
      errorCode: null,
      errorReason: null,
      errorSource: null,
      errorStep: null,
      description: null,
      referenceId,
    },
    paymentLink: { id: `plink_${referenceId}`, status: 'paid', amount, amountPaid: amount, referenceId },
    raw: {},
  };
}

export function buildCapturedEvent(providerPaymentId: string, amount: number): InboundEvent {
  return {
    providerEventId: `evt_cap_${providerPaymentId}`,
    eventType: 'payment.captured',
    createdAt: Math.floor(Date.now() / 1000),
    payment: {
      id: providerPaymentId,
      orderId: `order_${providerPaymentId}`,
      amount,
      currency: 'INR',
      status: 'captured',
      method: 'card',
      email: null,
      contact: null,
      errorCode: null,
      errorReason: null,
      errorSource: null,
      errorStep: null,
      description: null,
      referenceId: null,
    },
    paymentLink: null,
    raw: {},
  };
}
