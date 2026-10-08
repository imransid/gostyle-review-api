import type { RatingCounts } from '../rating/rating-summary';
import type { TxHandle } from './unit-of-work.port';

export const RATING_SUMMARY_REPOSITORY = Symbol('RATING_SUMMARY_REPOSITORY');

/** One storefront's summary row. A storefront is one per branch. */
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
   * Lock the storefront's row for this transaction, creating it (all zeros)
   * if it does not exist yet, and return what it holds.
   *
   * THE LOCK IS WHAT MAKES THE SUMMARY EXACT UNDER CONCURRENCY: every writer
   * for a storefront takes it before counting, so two reviews landing at once
   * are counted one after the other, never both from the same stale snapshot.
   */
  lock(key: SummaryKey, tx: TxHandle): Promise<SummarySnapshot>;

  /** Counts straight from the review rows: PUBLISHED only. */
  countVisible(storefrontId: string, tx?: TxHandle): Promise<RatingCounts>;

  /** Overwrite the row (bumping its version) and return the result. */
  replace(
    key: SummaryKey,
    counts: RatingCounts,
    opts: { recomputed: boolean },
    tx: TxHandle,
  ): Promise<SummarySnapshot>;

  /** Mark a row as checked by the recompute without changing it. */
  touchRecomputed(key: SummaryKey, tx: TxHandle): Promise<void>;

  /** Every storefront with a summary row or any review, oldest-checked first. */
  listSubjects(tx?: TxHandle): Promise<SummaryKey[]>;
}
