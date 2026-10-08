/**
 * Every rule the domain refuses with, by code.
 *
 * The code is the contract: the HTTP status lives in ONE place, the error
 * filter (src/shared/http/domain-error.filter.ts), so the domain never knows
 * it is behind HTTP and no controller maps errors by hand.
 */
export const DOMAIN_ERROR_CODES = [
  'INVITE_NOT_FOUND',
  'INVITE_EXPIRED',
  'INVITE_ALREADY_USED',
  'VALIDATION_FAILED',
  'REVIEW_NOT_FOUND',
  'REVIEW_TRANSITION_INVALID',
  'REPLY_NOT_FOUND',
  'REPLY_ALREADY_EXISTS',
  'REPORT_NOT_FOUND',
  'REPORT_ALREADY_OPEN',
  'REPORT_TRANSITION_INVALID',
] as const;
export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

/** One field problem, in the platform's closed vocabulary. */
export interface DomainErrorDetail {
  field: string;
  code: string;
  message: string;
}

/**
 * A broken business rule. Always coded, never a bare Error: the push service's
 * `Error('Already processed')` surfaced as a 500.
 */
export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message?: string,
    readonly details: DomainErrorDetail[] = [],
  ) {
    super(message ?? code);
    this.name = 'DomainError';
  }

  static validation(details: DomainErrorDetail[], message = 'One or more fields failed validation.') {
    return new DomainError('VALIDATION_FAILED', message, details);
  }
}
