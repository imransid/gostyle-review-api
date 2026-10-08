import type { Prisma } from '../../../generated/prisma/client';
import { EMPTY_COUNTS, toAggregate, type RatingCounts } from '../../domain/rating/rating-summary';
import { displayAuthor, type ReviewAggregate } from '../../domain/services/review-rules';

/** Shared read-side shapes and helpers. Reads go straight from rows to these. */

export const MAX_LIMIT = 50;
export const DEFAULT_LIMIT = 20;

/** The platform's paging rule: default 20, at most 50, offset at least 0. */
export function page(offset?: number, limit?: number) {
  return {
    offset: Math.max(offset ?? 0, 0),
    limit: Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT),
  };
}

type SummaryRow = Prisma.RatingSummaryGetPayload<object>;

export function countsOf(row: SummaryRow | null): RatingCounts {
  if (!row) return EMPTY_COUNTS;
  return {
    reviewCount: row.reviewCount,
    ratingSum: row.ratingSum,
    histogram: { '1': row.star1, '2': row.star2, '3': row.star3, '4': row.star4, '5': row.star5 },
    countByLanguage: { EN: row.countEn, AR: row.countAr },
  };
}

/** The aggregate every surface serves, from the stored row (or nothing yet). */
export function aggregateOf(row: SummaryRow | null): ReviewAggregate {
  return toAggregate(countsOf(row));
}

/** The name as the public sees it: blank renders as "Verified customer". */
export const shownName = displayAuthor;

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
