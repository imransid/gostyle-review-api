import { AggregateRoot } from '@nestjs/cqrs';
import { DomainError } from '../domain.error';
import {
  inviteExpiryFrom,
  refuseInvite,
  type InviteRefusal,
} from '../services/review-invite-rules';
import { uuidv7 } from '../shared/uuidv7';
import { BookingRef } from '../value-objects/booking-ref';
import { InviteToken } from '../value-objects/invite-token';
import { SubjectRef } from '../value-objects/subject-ref';
import { InviteCreated } from './invite.events';
import type { InviteSendStatus, SendOutcome } from './invite-send';

interface InviteProps {
  id: string;
  subject: SubjectRef;
  booking: BookingRef;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  customerId: string | null;
  salonName: string | null;
  storefrontSlug: string | null;
  locale: string | null;
  sendStatus: InviteSendStatus;
  sendAttempts: number;
  sentAt: Date | null;
  lastSendError: string | null;
  createdAt: Date;
}

/**
 * The only way to write a review: one per booking, single use, 30 days.
 *
 * Only the token's hash is held. The plaintext comes back from mint() (and
 * from rotateForRetry()) exactly once, for the message, and is gone after.
 */
export class ReviewInvite extends AggregateRoot {
  private constructor(private readonly p: InviteProps) {
    super();
  }

  static mint(input: {
    subject: SubjectRef;
    booking: BookingRef;
    customerId: string | null;
    display: { salonName: string | null; storefrontSlug: string | null; locale: string | null };
    now: Date;
    id?: string;
  }): { invite: ReviewInvite; token: InviteToken } {
    const token = InviteToken.mint();
    const invite = new ReviewInvite({
      id: input.id ?? uuidv7(input.now.getTime()),
      subject: input.subject,
      booking: input.booking,
      tokenHash: token.hash,
      expiresAt: inviteExpiryFrom(input.now),
      usedAt: null,
      customerId: input.customerId,
      salonName: input.display.salonName,
      storefrontSlug: input.display.storefrontSlug,
      locale: input.display.locale,
      sendStatus: 'PENDING',
      sendAttempts: 0,
      sentAt: null,
      lastSendError: null,
      createdAt: input.now,
    });
    invite.apply(
      new InviteCreated(invite.id, invite.subject.tenantId, input.now, {
        storefrontId: invite.subject.storefrontId,
        branchId: invite.subject.branchId,
        bookingSource: invite.booking.source,
        bookingId: invite.booking.id,
        expiresAt: invite.expiresAt.toISOString(),
      }),
    );
    return { invite, token };
  }

  static restore(p: InviteProps): ReviewInvite {
    return new ReviewInvite(p);
  }

  /** Why it cannot be redeemed now, or null. The ported rule decides. */
  refusal(now: Date): InviteRefusal | null {
    return refuseInvite({ expiresAt: this.p.expiresAt, usedAt: this.p.usedAt }, now);
  }

  /**
   * Spend it. Refuses with the precise reason first, so the customer is told
   * the truth. The CONDITIONAL update in the repository is the real single-use
   * guarantee; this is the message.
   */
  redeem(now: Date): void {
    const refusal = this.refusal(now);
    if (refusal !== null) throw new DomainError(refusal);
    this.p.usedAt = now;
  }

  // ─── the message ────────────────────────────────────────────────────────

  /** Record what a send attempt achieved. SENT is terminal. */
  recordSend(outcome: SendOutcome | { kind: 'no_contact' }, now: Date, retriesLeft: boolean): void {
    if (this.p.sendStatus === 'SENT') return;
    this.p.sendAttempts += outcome.kind === 'no_contact' ? 0 : 1;
    switch (outcome.kind) {
      case 'sent':
        this.p.sendStatus = 'SENT';
        this.p.sentAt = now;
        this.p.lastSendError = null;
        return;
      case 'no_contact':
        this.p.sendStatus = 'NO_CONTACT';
        return;
      case 'retry':
        this.p.sendStatus = retriesLeft ? 'RETRYING' : 'FAILED';
        this.p.lastSendError = outcome.error.slice(0, 500);
        return;
      case 'failed':
        this.p.sendStatus = 'FAILED';
        this.p.lastSendError = outcome.error.slice(0, 500);
        return;
      case 'unknown':
        this.p.sendStatus = 'UNKNOWN';
        this.p.lastSendError = outcome.error.slice(0, 500);
        return;
    }
  }

  /**
   * A retry needs a token, and the old one was never stored. Mint a new one
   * for the SAME invite. Safe only because the last send DEFINITELY did not
   * land (status RETRYING): the old link reached nobody, so nothing breaks.
   */
  rotateForRetry(now: Date): InviteToken | null {
    if (this.p.sendStatus !== 'RETRYING' || this.refusal(now) !== null) return null;
    const token = InviteToken.mint();
    this.p.tokenHash = token.hash;
    return token;
  }

  get id() {
    return this.p.id;
  }
  get subject() {
    return this.p.subject;
  }
  get booking() {
    return this.p.booking;
  }
  get tokenHash() {
    return this.p.tokenHash;
  }
  get expiresAt() {
    return this.p.expiresAt;
  }
  get usedAt() {
    return this.p.usedAt;
  }
  get customerId() {
    return this.p.customerId;
  }
  get salonName() {
    return this.p.salonName;
  }
  get storefrontSlug() {
    return this.p.storefrontSlug;
  }
  get locale() {
    return this.p.locale;
  }
  get sendStatus() {
    return this.p.sendStatus;
  }
  get sendAttempts() {
    return this.p.sendAttempts;
  }
  get sentAt() {
    return this.p.sentAt;
  }
  get lastSendError() {
    return this.p.lastSendError;
  }
  get createdAt() {
    return this.p.createdAt;
  }
}
