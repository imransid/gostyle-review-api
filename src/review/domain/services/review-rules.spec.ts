import { describe, it, expect } from 'vitest';
import {
  ANONYMOUS_AUTHOR_LABEL,
  AUTHOR_NAME_MAX,
  COMMENT_MAX,
  checkReviewSubmission,
  computeAggregate,
  displayAuthor,
  RATING_MAX,
  RATING_MIN,
  RatedReview,
  VISIBLE_REVIEW_STATES,
} from './review-rules';

const pairs = (errors: { field: string; code: string }[]) =>
  errors.map((e) => `${e.field}:${e.code}`).sort();

const submission = (over: Record<string, unknown> = {}) => ({
  rating: 5,
  comment: 'Lovely balayage, and they ran on time.',
  language: 'EN',
  ...over,
});

describe('checkReviewSubmission', () => {
  it('accepts a full submission from a booking that carried a name', () => {
    const r = checkReviewSubmission(submission(), 'Sara Idris');
    expect(r.errors).toEqual([]);
    expect(r.normalized.authorDisplayName).toBe('Sara Idris');
  });

  it('accepts a bare rating: prose is not required for a review to count', () => {
    const r = checkReviewSubmission({ rating: 4, language: 'AR' }, 'Sara');
    expect(r.errors).toEqual([]);
    expect(r.normalized.comment).toBeNull();
  });

  it('requires a rating, and holds it to one through five', () => {
    expect(pairs(checkReviewSubmission({ language: 'EN' }, null).errors)).toContain(
      'rating:REQUIRED',
    );
    for (const bad of [RATING_MIN - 1, RATING_MAX + 1, 0, 6, -3]) {
      expect(pairs(checkReviewSubmission(submission({ rating: bad }), null).errors)).toContain(
        'rating:OUT_OF_RANGE',
      );
    }
    expect(pairs(checkReviewSubmission(submission({ rating: 4.5 }), null).errors)).toContain(
      'rating:REQUIRED',
    );
  });

  it('rejects a language outside the two the product speaks', () => {
    expect(pairs(checkReviewSubmission(submission({ language: 'FR' }), null).errors)).toContain(
      'language:UNKNOWN_VALUE',
    );
  });

  it('caps the comment, because it is unauthenticated free text on a public page', () => {
    expect(
      pairs(
        checkReviewSubmission(submission({ comment: 'x'.repeat(COMMENT_MAX + 1) }), null).errors,
      ),
    ).toContain('comment:TOO_LONG');
    // Exactly at the cap is fine.
    expect(
      checkReviewSubmission(submission({ comment: 'x'.repeat(COMMENT_MAX) }), null).errors,
    ).toEqual([]);
  });

  it('collapses a whitespace-only comment to null rather than storing blanks', () => {
    expect(
      checkReviewSubmission(submission({ comment: '   ' }), null).normalized.comment,
    ).toBeNull();
  });

  describe('the author name', () => {
    it('THE BOOKING WINS: a reviewer cannot rename themselves over a name on file', () => {
      // Otherwise the token holder could publish arbitrary text as an
      // attribution, which is a byline the salon never agreed to.
      const r = checkReviewSubmission(
        submission({ authorDisplayName: 'Totally Someone Else' }),
        'Sara Idris',
      );
      expect(r.normalized.authorDisplayName).toBe('Sara Idris');
    });

    it('accepts the reviewer’s own name when the booking had none — a walk-in', () => {
      const r = checkReviewSubmission(submission({ authorDisplayName: '  Layla  ' }), null);
      expect(r.errors).toEqual([]);
      expect(r.normalized.authorDisplayName).toBe('Layla');
    });

    it('CAPS a self-supplied name, same class of input as the comment', () => {
      expect(
        pairs(
          checkReviewSubmission(
            submission({ authorDisplayName: 'x'.repeat(AUTHOR_NAME_MAX + 1) }),
            null,
          ).errors,
        ),
      ).toContain('authorDisplayName:TOO_LONG');
    });

    it('TRUNCATES an over-long name copied from the booking rather than refusing', () => {
      // The reviewer cannot fix a name they did not type, and failing their
      // review over the salon's own data entry would be absurd.
      const long = 'y'.repeat(AUTHOR_NAME_MAX + 20);
      const r = checkReviewSubmission(submission(), long);
      expect(r.errors).toEqual([]);
      expect(r.normalized.authorDisplayName).toHaveLength(AUTHOR_NAME_MAX);
    });

    it('stores an empty name when there is none anywhere, and does NOT invent one', () => {
      // The placeholder is a read-time substitution. Storing it would be a claim
      // the platform made up and could later not tell from a real one.
      const r = checkReviewSubmission(submission(), null);
      expect(r.errors).toEqual([]);
      expect(r.normalized.authorDisplayName).toBe('');
    });
  });
});

describe('displayAuthor', () => {
  it('renders an empty stored name as the verified-customer label', () => {
    expect(displayAuthor('')).toBe(ANONYMOUS_AUTHOR_LABEL);
    expect(displayAuthor('   ')).toBe(ANONYMOUS_AUTHOR_LABEL);
  });

  it('renders a real name unchanged', () => {
    expect(displayAuthor('Sara Idris')).toBe('Sara Idris');
  });
});

describe('computeAggregate', () => {
  const rated = (rating: number, language: 'EN' | 'AR'): RatedReview => ({ rating, language });

  it('averages across BOTH languages: a salon has one reputation', () => {
    const a = computeAggregate([rated(5, 'EN'), rated(4, 'AR'), rated(3, 'EN')]);
    expect(a.average).toBe(4);
    expect(a.count).toBe(3);
  });

  it('breaks the COUNT down per language, so the console knows what it can render', () => {
    const a = computeAggregate([rated(5, 'EN'), rated(4, 'AR'), rated(3, 'AR')]);
    expect(a.countByLanguage).toEqual({ EN: 1, AR: 2 });
    // A breakdown of the count, never a second rating.
    expect(a.countByLanguage.EN + a.countByLanguage.AR).toBe(a.count);
  });

  it('returns NULL for no reviews, not zero', () => {
    // Zero would render as one star, which is the worst possible thing to show
    // a salon that has never been reviewed.
    const a = computeAggregate([]);
    expect(a.average).toBeNull();
    expect(a.average).not.toBe(0);
    expect(a.count).toBe(0);
    expect(a.countByLanguage).toEqual({ EN: 0, AR: 0 });
  });

  it('rounds to one decimal, because that is what a star bar can render', () => {
    expect(computeAggregate([rated(5, 'EN'), rated(4, 'EN'), rated(4, 'EN')]).average).toBe(4.3);
    expect(computeAggregate([rated(5, 'EN'), rated(2, 'EN')]).average).toBe(3.5);
  });

  it('buckets every rating into the histogram', () => {
    const a = computeAggregate([rated(5, 'EN'), rated(5, 'AR'), rated(3, 'EN'), rated(1, 'EN')]);
    expect(a.histogram).toEqual({ '1': 1, '2': 0, '3': 1, '4': 0, '5': 2 });
    // A breakdown of the count, so it sums to it.
    expect(Object.values(a.histogram).reduce((x, y) => x + y, 0)).toBe(a.count);
  });

  it('ALWAYS carries all five bars, zeroes included', () => {
    // An absent bar and an empty bar are different things on a chart, and only
    // one of them is honest. The console renders five without inventing any.
    expect(computeAggregate([]).histogram).toEqual({
      '1': 0,
      '2': 0,
      '3': 0,
      '4': 0,
      '5': 0,
    });
    expect(Object.keys(computeAggregate([rated(4, 'EN')]).histogram)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ]);
  });

  it('IGNORES an out-of-range rating rather than growing a sixth bar', () => {
    // Unreachable through the API, which bounds 1..5 — but a hand-repaired row
    // must not silently add a bar the console has no place to draw.
    const a = computeAggregate([rated(4, 'EN'), rated(9, 'EN'), rated(0, 'EN')]);
    expect(Object.keys(a.histogram)).toHaveLength(5);
    expect(a.histogram['4']).toBe(1);
    // Still counted and still averaged: the row exists, and hiding it from the
    // count would make the bars disagree with the total.
    expect(a.count).toBe(3);
  });

  it('counts only what it was given: filtering by state is the caller’s job', () => {
    // The aggregate is pure. VISIBLE_REVIEW_STATES is what the repository
    // filters on, and it is PUBLISHED alone.
    expect(VISIBLE_REVIEW_STATES).toEqual(['PUBLISHED']);
  });
});
