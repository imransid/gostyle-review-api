import { DomainError } from '../domain.error';
import { REVIEW_LANGUAGES, type ReviewLanguage as Language } from '../services/review-rules';

/** The language the customer wrote in: EN or AR. */
export class ReviewLanguage {
  private constructor(readonly value: Language) {}

  static of(value: unknown): ReviewLanguage {
    if (!(REVIEW_LANGUAGES as readonly unknown[]).includes(value)) {
      throw DomainError.validation([
        {
          field: 'language',
          code: 'UNKNOWN_VALUE',
          message: `language must be one of: ${REVIEW_LANGUAGES.join(', ')}.`,
        },
      ]);
    }
    return new ReviewLanguage(value as Language);
  }
}
