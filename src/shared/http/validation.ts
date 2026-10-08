import { ValidationPipe, type ValidationError } from '@nestjs/common';
import { DomainError, type DomainErrorDetail } from '../../review/domain/domain.error';

/**
 * class-validator constraint -> the platform's closed detail vocabulary
 * (REQUIRED | INVALID_FORMAT | OUT_OF_RANGE | TOO_LONG | UNKNOWN_VALUE).
 */
const CODE_BY_CONSTRAINT: Record<string, string> = {
  isDefined: 'REQUIRED',
  isNotEmpty: 'REQUIRED',
  isInt: 'INVALID_FORMAT',
  isNumber: 'INVALID_FORMAT',
  isString: 'INVALID_FORMAT',
  isUuid: 'INVALID_FORMAT',
  isUUID: 'INVALID_FORMAT',
  isBoolean: 'INVALID_FORMAT',
  isObject: 'INVALID_FORMAT',
  isArray: 'INVALID_FORMAT',
  isDateString: 'INVALID_FORMAT',
  min: 'OUT_OF_RANGE',
  max: 'OUT_OF_RANGE',
  minLength: 'OUT_OF_RANGE',
  maxLength: 'TOO_LONG',
  isIn: 'UNKNOWN_VALUE',
  isEnum: 'UNKNOWN_VALUE',
  whitelistValidation: 'UNKNOWN_VALUE',
};

export function toDetails(errors: ValidationError[], prefix = ''): DomainErrorDetail[] {
  const out: DomainErrorDetail[] = [];
  for (const e of errors) {
    const field = prefix ? `${prefix}.${e.property}` : e.property;
    for (const [constraint, message] of Object.entries(e.constraints ?? {})) {
      out.push({ field, code: CODE_BY_CONSTRAINT[constraint] ?? 'INVALID_FORMAT', message });
    }
    if (e.children?.length) out.push(...toDetails(e.children, field));
  }
  return out;
}

/**
 * Validation at the edge. Body, query and param failures all leave as
 * VALIDATION_FAILED (422) with field details, through the one filter.
 */
export function edgeValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    exceptionFactory: (errors) => DomainError.validation(toDetails(errors)),
  });
}
