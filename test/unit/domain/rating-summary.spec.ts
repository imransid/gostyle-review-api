import { describe, expect, it } from 'vitest';
import {
  addCounts,
  contributionOf,
  countsFrom,
  EMPTY_COUNTS,
  isConsistent,
  isZero,
  toAggregate,
  visibilityDelta,
} from '../../../src/review/domain/rating/rating-summary';
import { computeAggregate, type RatedReview } from '../../../src/review/domain/services/review-rules';

// Deterministic pseudo-random reviews, so a failure reproduces.
function* reviews(seed: number, n: number): Generator<RatedReview> {
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) % 2 ** 31;
    yield { rating: (x % 5) + 1, language: (x >> 3) % 2 === 0 ? 'EN' : 'AR' };
  }
}

describe('stored counts render exactly what the ported computeAggregate renders', () => {
  it('for 200 random sets of reviews, including the empty set', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const set = [...reviews(seed, seed % 37)];
      expect(toAggregate(countsFrom(set)), `seed ${seed}`).toEqual(computeAggregate(set));
    }
  });

  it('average is null, not 0, with no reviews; every histogram key is present', () => {
    const a = toAggregate(EMPTY_COUNTS);
    expect(a.average).toBeNull();
    expect(a.count).toBe(0);
    expect(Object.keys(a.histogram)).toEqual(['1', '2', '3', '4', '5']);
  });

  it('rounds to one decimal', () => {
    expect(toAggregate(countsFrom([{ rating: 5, language: 'EN' }, { rating: 4, language: 'EN' }, { rating: 4, language: 'AR' }])).average).toBe(4.3);
  });
});

describe('visibilityDelta', () => {
  const r: RatedReview = { rating: 4, language: 'AR' };

  it('a new PUBLISHED review adds itself', () => {
    expect(visibilityDelta(r, null, 'PUBLISHED')).toEqual(contributionOf(r));
  });

  it('hiding or removing a PUBLISHED review takes it out; restoring puts it back', () => {
    expect(addCounts(contributionOf(r), visibilityDelta(r, 'PUBLISHED', 'HIDDEN'))).toEqual(EMPTY_COUNTS);
    expect(addCounts(contributionOf(r), visibilityDelta(r, 'PUBLISHED', 'REMOVED'))).toEqual(EMPTY_COUNTS);
    expect(visibilityDelta(r, 'HIDDEN', 'PUBLISHED')).toEqual(contributionOf(r));
  });

  it('a move between two hidden states changes nothing', () => {
    expect(isZero(visibilityDelta(r, 'HIDDEN', 'REMOVED'))).toBe(true);
  });

  it('any sequence of deltas equals a recompute of what is visible at the end', () => {
    const set = [...reviews(7, 40)];
    let counts = EMPTY_COUNTS;
    const states = set.map(() => 'PUBLISHED' as 'PUBLISHED' | 'HIDDEN' | 'REMOVED');
    set.forEach((rv) => (counts = addCounts(counts, visibilityDelta(rv, null, 'PUBLISHED'))));
    set.forEach((rv, i) => {
      const next = i % 3 === 0 ? 'HIDDEN' : i % 5 === 0 ? 'REMOVED' : 'PUBLISHED';
      counts = addCounts(counts, visibilityDelta(rv, states[i], next));
      states[i] = next;
    });
    expect(counts).toEqual(countsFrom(set.filter((_, i) => states[i] === 'PUBLISHED')));
    expect(isConsistent(counts)).toBe(true);
  });
});
