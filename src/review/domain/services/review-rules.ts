import { FieldError } from './field-error';

// ──────────────────────────────────────────────────────────────────────
// What a review may say, and what makes one writable.
//
// Pure. No Prisma, no Nest, no clock. ESLint boundaries enforces it.
//
// THE REVIEWER IS NOT A CONSOLE USER. Every other validator in this package
// guards a field a salon manager typed into an authenticated screen; this one
// guards free text arriving from the open internet with only a token behind
// it. So the bounds here are not ergonomics, they are the surface area: a
// comment cap is how much text one completed booking can put on a public page.
// ──────────────────────────────────────────────────────────────────────

/** Mirrors the `StorefrontReviewState` Prisma enum. */
export type ReviewState = 'PUBLISHED' | 'HIDDEN' | 'REMOVED';
export const REVIEW_STATES: readonly ReviewState[] = ['PUBLISHED', 'HIDDEN', 'REMOVED'];

/**
 * The states a review is counted and rendered in.
 *
 * PUBLISHED only. HIDDEN and REMOVED both mean "a human decided this should
 * not be on the page", and the difference between them is whether it can come
 * back, not whether it shows.
 */
export const VISIBLE_REVIEW_STATES: readonly ReviewState[] = ['PUBLISHED'];

/** Mirrors the `StorefrontReviewLanguage` Prisma enum. */
export type ReviewLanguage = 'EN' | 'AR';
export const REVIEW_LANGUAGES: readonly ReviewLanguage[] = ['EN', 'AR'];

export const RATING_MIN = 1;
export const RATING_MAX = 5;

/**
 * How much text one completed booking may put on a public page.
 *
 * 1000 is generous for a salon review and small enough that the field is not a
 * publishing surface. Optional: a bare star rating is a complete review, and
 * demanding prose would cost more ratings than it would gain sentences.
 */
export const COMMENT_MAX = 1000;

/**
 * The author's own name, when the booking has none to copy.
 *
 * CAPPED BECAUSE IT IS UNAUTHENTICATED FREE TEXT. A booking with no customer —
 * a walk-in — means the reviewer typed this themselves, so it is the same class
 * of input as the comment and gets the same treatment: trimmed, capped, and
 * moderated through the same state on the same row. 60 is a long real name and
 * far short of a sentence, which is the point.
 */
export const AUTHOR_NAME_MAX = 60;

/**
 * What a review with no usable name renders as.
 *
 * SUBSTITUTED AT READ TIME, never stored. The row keeps saying exactly what was
 * submitted — including nothing — because a stored placeholder would be a claim
 * the platform invented and later could not distinguish from a real one. Every
 * review here is behind a completed booking, so "Verified customer" is a fact
 * rather than a courtesy.
 */
export const ANONYMOUS_AUTHOR_LABEL = 'Verified customer';

const err = (field: string, code: FieldError['code'], message: string): FieldError => ({
  field,
  code,
  message,
});

export interface ReviewSubmission {
  rating: number;
  comment: string | null;
  language: ReviewLanguage;
  authorDisplayName: string;
}

export interface ReviewSubmissionValidation {
  errors: FieldError[];
  /** Trimmed. Usable only when `errors` is empty, same contract as checkBadge. */
  normalized: ReviewSubmission;
}

/**
 * Validate what a reviewer submitted.
 *
 * Never throws, matching every other check* in this package. The FALLBACK NAME
 * is applied here rather than at the call site: `authorDisplayName` is NOT NULL
 * in the schema, and leaving each caller to decide what an empty one becomes is
 * how two callers end up storing two different empties.
 *
 * `fallbackName` is what the booking already knew — the customer's name, copied
 * onto the invite at mint time. When it is absent the reviewer's own input is
 * the only source, and when that is absent too the row stores an empty string
 * and the READ substitutes ANONYMOUS_AUTHOR_LABEL.
 */
export function checkReviewSubmission(
  input: unknown,
  fallbackName: string | null,
): ReviewSubmissionValidation {
  const errors: FieldError[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;

  // ─── rating: the only required field ───
  const rating = raw.rating;
  if (typeof rating !== 'number' || !Number.isInteger(rating)) {
    errors.push(err('rating', 'REQUIRED', 'A rating is required.'));
  } else if (rating < RATING_MIN || rating > RATING_MAX) {
    errors.push(
      err('rating', 'OUT_OF_RANGE', `The rating must be between ${RATING_MIN} and ${RATING_MAX}.`),
    );
  }

  // ─── comment: optional, blank collapses to null ───
  let comment: string | null = null;
  if (raw.comment !== undefined && raw.comment !== null) {
    if (typeof raw.comment !== 'string') {
      errors.push(err('comment', 'INVALID_FORMAT', 'The comment must be text.'));
    } else {
      const trimmed = raw.comment.trim();
      if (trimmed.length > COMMENT_MAX) {
        errors.push(
          err('comment', 'TOO_LONG', `The comment must be at most ${COMMENT_MAX} characters.`),
        );
      }
      comment = trimmed.length > 0 ? trimmed : null;
    }
  }

  // ─── language ───
  const language = raw.language as ReviewLanguage;
  if (!(REVIEW_LANGUAGES as readonly string[]).includes(language)) {
    errors.push(
      err('language', 'UNKNOWN_VALUE', `language must be one of: ${REVIEW_LANGUAGES.join(', ')}.`),
    );
  }

  // ─── authorDisplayName ───
  // THE BOOKING WINS when it has a name. A reviewer cannot rename themselves
  // over a name the salon already has on file: that would let the token holder
  // publish arbitrary text under the guise of an attribution.
  let authorDisplayName = (fallbackName ?? '').trim();
  if (authorDisplayName.length === 0) {
    const supplied = raw.authorDisplayName;
    if (supplied !== undefined && supplied !== null) {
      if (typeof supplied !== 'string') {
        errors.push(err('authorDisplayName', 'INVALID_FORMAT', 'The name must be text.'));
      } else {
        const trimmed = supplied.trim();
        if (trimmed.length > AUTHOR_NAME_MAX) {
          errors.push(
            err(
              'authorDisplayName',
              'TOO_LONG',
              `The name must be at most ${AUTHOR_NAME_MAX} characters.`,
            ),
          );
        }
        authorDisplayName = trimmed;
      }
    }
  } else if (authorDisplayName.length > AUTHOR_NAME_MAX) {
    // A name copied from the booking can still be too long for a public card.
    // Truncated rather than refused: the reviewer cannot fix a name they did
    // not type, and failing their review over it would be absurd.
    authorDisplayName = authorDisplayName.slice(0, AUTHOR_NAME_MAX).trim();
  }

  return {
    errors,
    normalized: {
      rating: typeof rating === 'number' ? rating : 0,
      comment,
      language,
      authorDisplayName,
    },
  };
}

/** Errors only. Empty array means the submission is well formed. */
export function validateReviewSubmission(
  input: unknown,
  fallbackName: string | null,
): FieldError[] {
  return checkReviewSubmission(input, fallbackName).errors;
}

/** What a stored name renders as. Empty becomes the verified-customer label. */
export function displayAuthor(stored: string): string {
  const trimmed = stored.trim();
  return trimmed.length > 0 ? trimmed : ANONYMOUS_AUTHOR_LABEL;
}

// ─── The aggregate ────────────────────────────────────────────────────────

/** One review, reduced to what the aggregate is computed from. */
export interface RatedReview {
  rating: number;
  language: ReviewLanguage;
}

/** How many reviews sit at each star, 1 through 5. */
export type RatingHistogram = Record<'1' | '2' | '3' | '4' | '5', number>;

export interface ReviewAggregate {
  /**
   * The star rating, over EVERY visible review whatever language it is in.
   *
   * One number, because a salon has one reputation. Splitting the average by
   * language would give the same salon two ratings and invite the reader to
   * pick the flattering one.
   *
   * Null when there is nothing to average — NOT 0, which would render as one
   * star and is the worst possible thing to show a salon with no reviews yet.
   */
  average: number | null;
  count: number;
  /**
   * How many reviews exist IN EACH LANGUAGE, so the console can tell how many
   * it can actually render on each side of the bilingual toggle. These sum to
   * `count`; they are a breakdown of it, never a second rating.
   */
  countByLanguage: Record<ReviewLanguage, number>;
  /**
   * The bar chart on the reviews screen: how many reviews at each star.
   *
   * EVERY KEY IS ALWAYS PRESENT, zero included, so the console renders five
   * bars without having to invent the missing ones — and so a salon with no
   * one-star reviews sees an empty bar rather than a gap where a bar should
   * be. These sum to `count`.
   *
   * Served on the aggregate rather than computed console-side because the same
   * numbers appear in two places, and two computations of one fact drift.
   */
  histogram: RatingHistogram;
}

/**
 * Average and count, computed from the rows.
 *
 * DELIBERATELY NOT MATERIALISED. A stored average drifts from its rows the
 * first time a moderator hides one, and a drifted rating is worse than a query
 * that takes two milliseconds — the index on (storefrontId, state, createdAt)
 * is what keeps it that cheap. Materialise only if profiling says so, and put
 * the profile in the commit that does it.
 *
 * Rounded to ONE DECIMAL, because that is what a star bar can render and
 * because 4.3 and 4.28 are the same claim. Rounding here rather than in the
 * console keeps every surface showing the same number.
 */
export function computeAggregate(reviews: readonly RatedReview[]): ReviewAggregate {
  const countByLanguage = { EN: 0, AR: 0 } as Record<ReviewLanguage, number>;
  // Seeded with all five keys at zero: an absent bar and an empty bar are
  // different things on a chart, and only one of them is honest.
  const histogram: RatingHistogram = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  let total = 0;

  for (const r of reviews) {
    total += r.rating;
    if (r.language in countByLanguage) countByLanguage[r.language] += 1;
    const bucket = String(r.rating) as keyof RatingHistogram;
    // Guarded: a rating outside 1..5 cannot be written through the API, but a
    // hand-repaired row must not silently create a sixth bar.
    if (bucket in histogram) histogram[bucket] += 1;
  }

  return {
    average: reviews.length === 0 ? null : Math.round((total / reviews.length) * 10) / 10,
    count: reviews.length,
    countByLanguage,
    histogram,
  };
}
