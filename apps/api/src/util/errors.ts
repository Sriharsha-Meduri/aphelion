/** Typed errors. User-facing surfaces never leak internal details or stack traces. */

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly expose: boolean;

  constructor(message: string, opts: { statusCode?: number; code?: string; expose?: boolean } = {}) {
    super(message);
    this.name = new.target.name;
    this.statusCode = opts.statusCode ?? 500;
    this.code = opts.code ?? 'internal_error';
    this.expose = opts.expose ?? false;
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, { statusCode: 400, code: 'validation_error', expose: true });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, { statusCode: 401, code: 'unauthorized', expose: true });
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(message, { statusCode: 404, code: 'not_found', expose: true });
  }
}

/** A deterministic policy gate refused an action. This is a safe, expected outcome, not a bug. */
export class PolicyError extends AppError {
  constructor(message: string) {
    super(message, { statusCode: 409, code: 'policy_blocked', expose: true });
  }
}

/** An illegal state-machine transition was attempted (e.g. a stale event on a recovered case). */
export class DomainError extends AppError {
  constructor(message: string) {
    super(message, { statusCode: 409, code: 'domain_conflict', expose: true });
  }
}

export class RazorpayError extends AppError {
  constructor(message: string) {
    super(message, { statusCode: 502, code: 'razorpay_error', expose: false });
  }
}

export class LLMError extends AppError {
  constructor(message: string) {
    super(message, { statusCode: 502, code: 'llm_error', expose: false });
  }
}

export function toErrorInfo(err: unknown): { name: string; message: string; code?: string; stack?: string } {
  if (err instanceof AppError) return { name: err.name, message: err.message, code: err.code, stack: err.stack };
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack };
  return { name: 'UnknownError', message: String(err) };
}
