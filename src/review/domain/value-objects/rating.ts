import { DomainError } from '../domain.error';
import { RATING_MAX, RATING_MIN } from '../services/review-rules';

/** A whole number of stars, 1 to 5. Also a CHECK constraint in the database. */
export class Rating {
  private constructor(readonly value: number) {}

  static of(value: unknown): Rating {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw DomainError.validation([
        { field: 'rating', code: 'REQUIRED', message: 'A rating is required.' },
      ]);
    }
    if (value < RATING_MIN || value > RATING_MAX) {
      throw DomainError.validation([
        {
          field: 'rating',
          code: 'OUT_OF_RANGE',
          message: `The rating must be between ${RATING_MIN} and ${RATING_MAX}.`,
        },
      ]);
    }
    return new Rating(value);
  }
}
