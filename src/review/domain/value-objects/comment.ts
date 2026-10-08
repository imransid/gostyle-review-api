import { DomainError } from '../domain.error';
import { COMMENT_MAX } from '../services/review-rules';

/**
 * Optional free text from the open internet. Trimmed; a blank one is NO
 * comment (null), never an empty string; at most COMMENT_MAX characters.
 */
export class Comment {
  private constructor(readonly value: string | null) {}

  static of(raw: string | null | undefined): Comment {
    if (raw === null || raw === undefined) return new Comment(null);
    if (typeof raw !== 'string') {
      throw DomainError.validation([
        { field: 'comment', code: 'INVALID_FORMAT', message: 'The comment must be text.' },
      ]);
    }
    const trimmed = raw.trim();
    if (trimmed.length > COMMENT_MAX) {
      throw DomainError.validation([
        {
          field: 'comment',
          code: 'TOO_LONG',
          message: `The comment must be at most ${COMMENT_MAX} characters.`,
        },
      ]);
    }
    return new Comment(trimmed.length > 0 ? trimmed : null);
  }
}
