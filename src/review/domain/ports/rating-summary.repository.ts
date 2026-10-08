import type { RatingCounts } from '../rating/rating-summary';
import type { TxHandle } from './unit-of-work.port';

export const RATING_SUMMARY_REPOSITORY = Symbol('RATING_SUMMARY_REPOSITORY');

export interface SummaryKey {
  storefrontId: string;
  tenantId: string;
  branchId: string;
}

export interface SummarySnapshot extends SummaryKey {
  counts: RatingCounts;
  /** Bumped on every write; consumers keep the highest they have seen. */
  version: bigint;
  updatedAt: Date;
}

export interface RatingSummaryRepository {
  /**
   * Apply a delta atomically (one UPDATE ... SET n = n + d), creating the row
   * if needed, and return the result. Safe under concurrent writers for the
   * same storefront without a read-modify-write.
   */
  applyDelta(key: SummaryKey, delta: RatingCounts, tx?: TxHandle): Promise<SummarySnapshot>;

  /** Overwrite with recomputed counts (the nightly repair). */
  replace(key: SummaryKey, counts: RatingCounts, tx?: TxHandle): Promise<SummarySnapshot>;

  /** Lock the row (creating it if absent) so a recompute reads a stable set. */
  lock(key: SummaryKey, tx: TxHandle): Promise<SummarySnapshot>;

  /** Counts from the review rows themselves: PUBLISHED only. */
  countVisible(storefrontId: string, tx?: TxHandle): Promise<RatingCounts>;

  /** Every storefront that has a summary row or any review. */
  listSubjects(tx?: TxHandle): Promise<SummaryKey[]>;
}
