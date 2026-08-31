import { randomUUID, createHash } from 'node:crypto';

/** Correlation id threaded through logs and audit records for one processing run. */
export function correlationId(): string {
  return `cor_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

export function uuid(): string {
  return randomUUID();
}

/**
 * Deterministic idempotency key when a provider event lacks a stable id.
 * Prefer the provider event id; this is a documented fallback only.
 */
export function deterministicEventId(parts: Array<string | number | null | undefined>): string {
  const hash = createHash('sha256').update(parts.map((p) => String(p ?? '')).join('|')).digest('hex');
  return `evt_fallback_${hash.slice(0, 32)}`;
}

/** Stable reference id for a Razorpay Payment Link (must be unique per link, max 40 chars). */
export function recoveryReferenceId(caseId: string, attempt: number): string {
  return `rcv_${caseId.replace(/-/g, '').slice(0, 24)}_${attempt}`;
}
