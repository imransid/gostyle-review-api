// Copied verbatim from gostyle-platform's nest-storefront
// domain/services/section-schema.ts, the only part of that file the ported
// review rules use. The rest of section-schema is storefront-editor code.

export interface FieldError {
  /** Dot path into the payload. The empty string means the payload as a whole. */
  field: string;
  code: FieldErrorCode;
  message: string;
}

/** The closed vocabulary from ContractValidationPipe. Do not extend casually. */
export type FieldErrorCode =
  | 'REQUIRED'
  | 'INVALID_FORMAT'
  | 'OUT_OF_RANGE'
  | 'TOO_LONG'
  | 'UNKNOWN_VALUE';
