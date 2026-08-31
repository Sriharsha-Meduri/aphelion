import type { CaseContext } from '../domain/context';
import type { Customer, Payment, RecoveryCase } from '../domain/types';
import { valueTier } from '../util/money';
import { classifyFailure } from '../diagnosis/failure-classifier';

export function buildCaseContext(args: {
  payment: Payment;
  customer: Customer;
  recoveryCase: RecoveryCase;
  now: Date;
  failureTime: Date;
}): CaseContext {
  const { payment, customer, recoveryCase, now, failureTime } = args;
  const diag = classifyFailure({
    errorCode: payment.errorCode,
    errorReason: payment.errorReason,
    errorSource: payment.errorSource,
    method: payment.method,
  });
  const timeSinceFailureMinutes = Math.max(0, (now.getTime() - failureTime.getTime()) / 60000);
  const hourOfDay = istHour(now);

  return {
    caseId: recoveryCase.id,
    correlationId: recoveryCase.correlationId,
    merchantId: payment.merchantId,
    amount: payment.amount,
    currency: payment.currency,
    valueTier: valueTier(payment.amount),
    method: payment.method,
    failureCategory: payment.failureCategory ?? diag.category,
    transient: diag.transient,
    baseRecoverability: diag.baseRecoverability,
    errorCode: payment.errorCode,
    errorReason: payment.errorReason,
    errorSource: payment.errorSource,
    attempts: recoveryCase.attempts,
    timeSinceFailureMinutes,
    hourOfDay,
    isBusinessHours: hourOfDay >= 9 && hourOfDay < 21,
    customer: {
      customerKey: customer.customerKey,
      priorSuccesses: customer.priorSuccesses,
      priorFailures: customer.priorFailures,
      priorRecoveries: customer.priorRecoveries,
      optedOut: customer.optedOut,
      ageDays: daysBetween(customer.firstSeenAt, now),
      recencyDays: daysBetween(customer.lastSeenAt, now),
    },
    descriptionRaw: payment.description,
  };
}

/** Hour of day in IST (UTC+5:30), used for business-hours features. */
function istHour(d: Date): number {
  return new Date(d.getTime() + 5.5 * 3600 * 1000).getUTCHours();
}

function daysBetween(a: Date, b: Date): number {
  return Math.max(0, Math.floor((b.getTime() - a.getTime()) / 86400000));
}
