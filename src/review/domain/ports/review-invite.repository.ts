import type { ReviewInvite } from '../invite/review-invite.aggregate';
import type { TxHandle } from './unit-of-work.port';

export const REVIEW_INVITE_REPOSITORY = Symbol('REVIEW_INVITE_REPOSITORY');

export interface ReviewInviteRepository {
  /**
   * Insert, or do nothing when this booking already has an invite.
   *
   * IDEMPOTENT BY DESIGN: completion events are delivered at least once, and a
   * second completion must not mint a second way in. False means "already
   * invited", which is ordinary, not an error.
   */
  insertIfAbsent(invite: ReviewInvite, tx?: TxHandle): Promise<boolean>;

  /** By the HASH of a presented token, never the token. Any tenant: the token is the key. */
  findByTokenHash(tokenHash: string, tx?: TxHandle): Promise<ReviewInvite | null>;

  findById(id: string, tx?: TxHandle): Promise<ReviewInvite | null>;

  /**
   * Stamp it used ONLY if it is still unused and unexpired, in the caller's
   * transaction. The real single-use guarantee: two concurrent redemptions
   * both pass refuseInvite, and only one of them flips the row.
   */
  markUsed(id: string, now: Date, tx?: TxHandle): Promise<boolean>;

  /** Persist send bookkeeping (status, attempts, sent_at, last error). */
  saveSendState(invite: ReviewInvite, tx?: TxHandle): Promise<void>;

  /**
   * Swap in a rotated token hash, ONLY while the invite is RETRYING and
   * unused. False when it was sent, used or changed meanwhile.
   */
  saveRotatedToken(invite: ReviewInvite, tx?: TxHandle): Promise<boolean>;

  /** Forget the customer on their invites (EraseCustomerReviews). */
  eraseCustomer(customerId: string, tenantId: string | null, tx?: TxHandle): Promise<number>;
}
