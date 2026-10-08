import { DomainError } from '../domain.error';
import { AUTHOR_NAME_MAX, displayAuthor } from '../services/review-rules';

/**
 * The name on a review, COPIED at write time and never joined.
 *
 * Stored AS ENTERED, which may be empty. "Verified customer" is substituted
 * at read time by display(), so the row never holds a placeholder the platform
 * invented. Which name wins (the booking's over the typed one) is decided by
 * checkReviewSubmission before this is built.
 */
export class AuthorName {
  private constructor(readonly stored: string) {}

  static of(stored: string): AuthorName {
    if (typeof stored !== 'string') {
      throw DomainError.validation([
        { field: 'authorDisplayName', code: 'INVALID_FORMAT', message: 'The name must be text.' },
      ]);
    }
    if (stored.length > AUTHOR_NAME_MAX) {
      throw DomainError.validation([
        {
          field: 'authorDisplayName',
          code: 'TOO_LONG',
          message: `The name must be at most ${AUTHOR_NAME_MAX} characters.`,
        },
      ]);
    }
    return new AuthorName(stored);
  }

  /** What the public sees. Empty renders as the verified-customer label. */
  display(): string {
    return displayAuthor(this.stored);
  }
}
