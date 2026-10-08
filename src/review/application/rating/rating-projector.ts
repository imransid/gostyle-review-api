import { Inject, Injectable, Logger } from '@nestjs/common';
import { OUTBOX_WRITER, type OutboxWriter } from '../../../shared/outbox/outbox.port';
import {
  RATING_SUMMARY_REPOSITORY,
  type RatingSummaryRepository,
  type SummaryKey,
  type SummarySnapshot,
} from '../../domain/ports/rating-summary.repository';
import type { TxHandle } from '../../domain/ports/unit-of-work.port';
import {
  addCounts,
  isZero,
  sameCounts,
  toAggregate,
  visibilityDelta,
  type RatingCounts,
} from '../../domain/rating/rating-summary';
import type { ReviewState } from '../../domain/review/review-state';
import type { RatedReview } from '../../domain/services/review-rules';
import { uuidv7 } from '../../domain/shared/uuidv7';

export const RATING_SUMMARY_CHANGED = 'rating.summary.changed.v1';

export type SummaryCause = 'review_change' | 'recompute';

/** What customer-api's local copy receives. */
export function summaryChangedPayload(s: SummarySnapshot, cause: SummaryCause) {
  const a = toAggregate(s.counts);
  return {
    subjectType: 'STOREFRONT',
    storefrontId: s.storefrontId,
    tenantId: s.tenantId,
    branchId: s.branchId,
    reviewCount: s.counts.reviewCount,
    ratingSum: s.counts.ratingSum,
    average: a.average,
    histogram: a.histogram,
    countByLanguage: a.countByLanguage,
    // A string: JSON has no 64-bit integers.
    version: s.version.toString(),
    updatedAt: s.updatedAt.toISOString(),
    cause,
  };
}

/**
 * Keeps rating_summary equal to its rows, INSIDE the transaction of the
 * review change that moved it.
 *
 * The stored row is not patched with a delta; it is LOCKED, recounted from
 * the review rows, and replaced. Under the lock the recount sees every
 * committed review plus this transaction's own, so concurrent writers for one
 * storefront are serialised and the stored counts cannot drift through this
 * path at all. The delta is still computed: it says whether anything changed
 * (a reply, or HIDDEN -> REMOVED, changes nothing), and it is the expectation
 * the recount is checked against, so a drift that crept in some other way is
 * logged the moment it is found.
 */
@Injectable()
export class RatingProjector {
  private static readonly log = new Logger(RatingProjector.name);

  constructor(
    @Inject(RATING_SUMMARY_REPOSITORY) private readonly summaries: RatingSummaryRepository,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
  ) {}

  /** A review's visibility moved from `before` to `after`. */
  async onReviewChange(
    key: SummaryKey,
    review: RatedReview,
    before: ReviewState | null,
    after: ReviewState,
    tx: TxHandle,
  ): Promise<SummarySnapshot | null> {
    const delta = visibilityDelta(review, before, after);
    if (isZero(delta)) return null;

    const stored = await this.summaries.lock(key, tx);
    const actual = await this.summaries.countVisible(key.storefrontId, tx);
    const expected = addCounts(stored.counts, delta);
    if (!sameCounts(expected, actual)) {
      RatingProjector.log.error(
        `rating_summary for storefront ${key.storefrontId} had drifted ` +
          `(stored ${describe(stored.counts)}, rows ${describe(actual)} after this change); repaired`,
      );
    }
    return this.write(key, actual, 'review_change', false, tx);
  }

  /**
   * The nightly check for one storefront: recount, compare, repair. Returns
   * the difference found, or null when the stored row was already right.
   */
  async recompute(
    key: SummaryKey,
    tx: TxHandle,
  ): Promise<{ stored: RatingCounts; actual: RatingCounts } | null> {
    const stored = await this.summaries.lock(key, tx);
    const actual = await this.summaries.countVisible(key.storefrontId, tx);
    if (sameCounts(stored.counts, actual)) {
      await this.summaries.touchRecomputed(key, tx);
      return null;
    }
    await this.write(key, actual, 'recompute', true, tx);
    return { stored: stored.counts, actual };
  }

  private async write(
    key: SummaryKey,
    counts: RatingCounts,
    cause: SummaryCause,
    recomputed: boolean,
    tx: TxHandle,
  ): Promise<SummarySnapshot> {
    const snapshot = await this.summaries.replace(key, counts, { recomputed }, tx);
    await this.outbox.append(
      [
        {
          id: uuidv7(),
          tenantId: key.tenantId,
          aggregateType: 'rating_summary',
          aggregateId: key.storefrontId,
          eventType: RATING_SUMMARY_CHANGED,
          payload: summaryChangedPayload(snapshot, cause),
          occurredAt: snapshot.updatedAt,
        },
      ],
      tx,
    );
    return snapshot;
  }
}

export function describe(c: RatingCounts): string {
  const h = c.histogram;
  return `count=${c.reviewCount} sum=${c.ratingSum} stars=${h['1']}/${h['2']}/${h['3']}/${h['4']}/${h['5']} en=${c.countByLanguage.EN} ar=${c.countByLanguage.AR}`;
}
