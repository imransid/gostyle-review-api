import {
  type RatedReview,
  type RatingHistogram,
  type ReviewAggregate,
  type ReviewLanguage,
} from '../services/review-rules';
import { isVisible, type ReviewState } from '../review/review-state';

/**
 * The stored rating, as counts.
 *
 * The platform computed the aggregate from the rows on every read and refused
 * to store it, because a stored average drifts. Across a service boundary
 * customer-api cannot run that query, so the summary is stored, and the drift
 * risk is handled instead: every change applies its delta in the same
 * transaction as the review change, and a nightly recompute compares and
 * repairs.
 *
 * COUNTS, never an average: an average cannot be updated by a delta without
 * the count, and a rounded average cannot be updated at all. The average is
 * derived at read time by toAggregate(), with the same rounding as the ported
 * computeAggregate(), so a stored summary and a full recompute render the same
 * number.
 */
export interface RatingCounts {
  reviewCount: number;
  ratingSum: number;
  histogram: RatingHistogram;
  countByLanguage: Record<ReviewLanguage, number>;
}

export const EMPTY_COUNTS: RatingCounts = Object.freeze({
  reviewCount: 0,
  ratingSum: 0,
  histogram: Object.freeze({ '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 }),
  countByLanguage: Object.freeze({ EN: 0, AR: 0 }),
}) as RatingCounts;

const STARS = ['1', '2', '3', '4', '5'] as const;

/** One review's contribution to its storefront's counts. */
export function contributionOf(r: RatedReview): RatingCounts {
  const histogram = { ...EMPTY_COUNTS.histogram };
  const bucket = String(r.rating) as keyof RatingHistogram;
  if (bucket in histogram) histogram[bucket] = 1;
  const countByLanguage = { ...EMPTY_COUNTS.countByLanguage };
  if (r.language in countByLanguage) countByLanguage[r.language] = 1;
  return { reviewCount: 1, ratingSum: r.rating, histogram, countByLanguage };
}

/** a + sign * b, field by field. */
export function addCounts(a: RatingCounts, b: RatingCounts, sign: 1 | -1 = 1): RatingCounts {
  const histogram = { ...a.histogram };
  for (const s of STARS) histogram[s] = a.histogram[s] + sign * b.histogram[s];
  return {
    reviewCount: a.reviewCount + sign * b.reviewCount,
    ratingSum: a.ratingSum + sign * b.ratingSum,
    histogram,
    countByLanguage: {
      EN: a.countByLanguage.EN + sign * b.countByLanguage.EN,
      AR: a.countByLanguage.AR + sign * b.countByLanguage.AR,
    },
  };
}

export function isZero(c: RatingCounts): boolean {
  return sameCounts(c, EMPTY_COUNTS);
}

export function sameCounts(a: RatingCounts, b: RatingCounts): boolean {
  return (
    a.reviewCount === b.reviewCount &&
    a.ratingSum === b.ratingSum &&
    STARS.every((s) => a.histogram[s] === b.histogram[s]) &&
    a.countByLanguage.EN === b.countByLanguage.EN &&
    a.countByLanguage.AR === b.countByLanguage.AR
  );
}

/**
 * What a review's change does to its storefront's counts.
 *
 * Only VISIBILITY matters: a review counts while PUBLISHED and not otherwise.
 * `before` is null for a new review. A change between two hidden states
 * (HIDDEN -> REMOVED) is a zero delta, and the caller writes nothing.
 */
export function visibilityDelta(
  review: RatedReview,
  before: ReviewState | null,
  after: ReviewState,
): RatingCounts {
  const was = before !== null && isVisible(before);
  const is = isVisible(after);
  if (was === is) return EMPTY_COUNTS;
  return addCounts(EMPTY_COUNTS, contributionOf(review), is ? 1 : -1);
}

/** The counts a full recompute produces from VISIBLE reviews. */
export function countsFrom(visible: readonly RatedReview[]): RatingCounts {
  return visible.reduce((acc, r) => addCounts(acc, contributionOf(r)), EMPTY_COUNTS);
}

/**
 * The aggregate every surface serves, from stored counts.
 *
 * Average rounded to one decimal, and NULL (never 0) with no reviews: zero
 * would render as one star on a salon nobody has judged yet. Every histogram
 * key is always present.
 */
export function toAggregate(c: RatingCounts): ReviewAggregate {
  return {
    average: c.reviewCount === 0 ? null : Math.round((c.ratingSum / c.reviewCount) * 10) / 10,
    count: c.reviewCount,
    countByLanguage: { EN: c.countByLanguage.EN, AR: c.countByLanguage.AR },
    histogram: { ...EMPTY_COUNTS.histogram, ...c.histogram },
  };
}

/** Structural sanity: what the CHECK constraints on rating_summary also say. */
export function isConsistent(c: RatingCounts): boolean {
  const stars = STARS.reduce((n, s) => n + c.histogram[s], 0);
  const weighted = STARS.reduce((n, s) => n + Number(s) * c.histogram[s], 0);
  return (
    c.reviewCount >= 0 &&
    STARS.every((s) => c.histogram[s] >= 0) &&
    c.countByLanguage.EN >= 0 &&
    c.countByLanguage.AR >= 0 &&
    stars === c.reviewCount &&
    c.countByLanguage.EN + c.countByLanguage.AR === c.reviewCount &&
    weighted === c.ratingSum
  );
}
