import type { Review } from '../review/review.aggregate';
import type { ReviewState } from '../review/review-state';
import type { TxHandle } from './unit-of-work.port';

export const REVIEW_REPOSITORY = Symbol('REVIEW_REPOSITORY');

export interface ReviewRepository {
  /**
   * Any tenant. For HQ moderation and internal jobs only; console paths use
   * findForSalon so a salon can never load another salon's review.
   */
  findById(id: string, tx?: TxHandle): Promise<Review | null>;

  /**
   * Scoped to the salon in the JWT: tenant AND branch in the WHERE. Null when
   * the review belongs to anyone else, which callers answer with 404.
   */
  findForSalon(
    id: string,
    salon: { tenantId: string; branchId: string },
    tx?: TxHandle,
  ): Promise<Review | null>;

  /**
   * Insert a new review. A second review for the same booking violates
   * UNIQUE (booking_source, booking_id) and is reported as INVITE_ALREADY_USED:
   * the third line of single-use defence, behind the invite's conditional
   * update.
   */
  insert(review: Review, tx?: TxHandle): Promise<void>;

  /**
   * Write a state change, compare-and-set against `expected`. False when the
   * review had already moved (a second moderator got there first).
   */
  saveState(review: Review, expected: ReviewState, tx?: TxHandle): Promise<boolean>;

  /**
   * Write the reply change the aggregate recorded (create, edit or hard
   * delete). A concurrent second create violates UNIQUE (review_id) and is
   * reported as REPLY_ALREADY_EXISTS.
   */
  saveReply(review: Review, tx?: TxHandle): Promise<void>;

  /** Blank the author name and customer id on every review by this customer. */
  eraseCustomer(customerId: string, tenantId: string | null, tx?: TxHandle): Promise<number>;
}
