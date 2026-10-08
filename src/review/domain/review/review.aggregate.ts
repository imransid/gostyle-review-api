import { AggregateRoot } from '@nestjs/cqrs';
import { DomainError } from '../domain.error';
import { validateResolutionNote } from '../services/review-report-rules';
import { uuidv7 } from '../shared/uuidv7';
import { AuthorName } from '../value-objects/author-name';
import { BookingRef } from '../value-objects/booking-ref';
import { Comment } from '../value-objects/comment';
import { Rating } from '../value-objects/rating';
import { ReviewLanguage } from '../value-objects/review-language';
import { SubjectRef } from '../value-objects/subject-ref';
import { Reply } from './reply.entity';
import {
  ModerationCause,
  ReplyDeleted,
  ReplyEdited,
  ReplyPosted,
  ReviewHidden,
  ReviewRemoved,
  ReviewRestored,
  ReviewSubmitted,
} from './review.events';
import { canTransition, isVisible, type ReviewState } from './review-state';

/** A console caller, as the JWT says: which salon they are working in. */
export interface SalonActor {
  tenantId: string;
  branchId: string;
  userId: string;
}

export interface Moderation {
  byId: string;
  at: Date;
  note: string;
}

/** What persistence needs to write a reply change. */
export type ReplyChange = 'created' | 'edited' | 'deleted' | null;

interface ReviewProps {
  id: string;
  subject: SubjectRef;
  booking: BookingRef;
  inviteId: string;
  customerId: string | null;
  rating: Rating;
  comment: Comment;
  language: ReviewLanguage;
  authorName: AuthorName;
  state: ReviewState;
  moderation: Moderation | null;
  createdAt: Date;
  reply: Reply | null;
}

/**
 * One customer's review of one salon, behind one completed booking.
 *
 * Written ONCE, by redeeming an invite; the words never change after that.
 * What changes is the state (only HQ moves it) and the salon's reply (only
 * the salon that received the review writes it).
 */
export class Review extends AggregateRoot {
  /** The state as loaded: persistence writes compare-and-set against it. */
  readonly loadedState: ReviewState | null;
  private _replyChange: ReplyChange = null;
  private _deletedReplyId: string | null = null;

  private constructor(
    private readonly p: ReviewProps,
    loaded: boolean,
  ) {
    super();
    this.loadedState = loaded ? p.state : null;
  }

  /**
   * A new review, from an invite that was just redeemed. The invite supplies
   * the tenant, salon, booking and customer; nothing comes from the request.
   */
  static submit(input: {
    invite: { id: string; subject: SubjectRef; booking: BookingRef; customerId: string | null };
    rating: Rating;
    comment: Comment;
    language: ReviewLanguage;
    authorName: AuthorName;
    now: Date;
    id?: string;
  }): Review {
    const review = new Review(
      {
        id: input.id ?? uuidv7(input.now.getTime()),
        subject: input.invite.subject,
        booking: input.invite.booking,
        inviteId: input.invite.id,
        customerId: input.invite.customerId,
        rating: input.rating,
        comment: input.comment,
        language: input.language,
        authorName: input.authorName,
        state: 'PUBLISHED',
        moderation: null,
        createdAt: input.now,
        reply: null,
      },
      false,
    );
    review.apply(
      new ReviewSubmitted(review.id, review.subject.tenantId, input.now, {
        storefrontId: review.subject.storefrontId,
        branchId: review.subject.branchId,
        inviteId: review.inviteId,
        bookingSource: review.booking.source,
        bookingId: review.booking.id,
        rating: review.rating.value,
        language: review.language.value,
      }),
    );
    return review;
  }

  static restore(p: ReviewProps): Review {
    return new Review(p, true);
  }

  // ─── ownership ──────────────────────────────────────────────────────────

  /**
   * Only staff of the salon that received the review may touch it. 404, not
   * 403: a salon has no business learning that a review id it guessed exists.
   */
  assertOwnedBy(salon: SalonActor): void {
    if (!this.p.subject.ownedBy(salon)) {
      throw new DomainError('REVIEW_NOT_FOUND');
    }
  }

  // ─── the salon's reply ──────────────────────────────────────────────────

  /** Answer once. A second reply is refused, never an overwrite. */
  postReply(salon: SalonActor, body: unknown, now: Date): Reply {
    this.assertOwnedBy(salon);
    if (this.p.reply !== null) {
      throw new DomainError(
        'REPLY_ALREADY_EXISTS',
        'This review already has a reply. Edit it instead of adding a second one.',
      );
    }
    const reply = Reply.write({ id: uuidv7(now.getTime()), body, authorId: salon.userId, now });
    this.p.reply = reply;
    this._replyChange = 'created';
    this.apply(
      new ReplyPosted(this.id, this.subject.tenantId, now, {
        replyId: reply.id,
        storefrontId: this.subject.storefrontId,
      }),
    );
    return reply;
  }

  /** Any staff member of the salon may edit; editedById records who did. */
  editReply(salon: SalonActor, body: unknown, now: Date): Reply {
    this.assertOwnedBy(salon);
    const reply = this.requireReply();
    reply.edit(body, salon.userId, now);
    if (this._replyChange === null) this._replyChange = 'edited';
    this.apply(
      new ReplyEdited(this.id, this.subject.tenantId, now, {
        replyId: reply.id,
        storefrontId: this.subject.storefrontId,
        editedById: salon.userId,
      }),
    );
    return reply;
  }

  /** HARD delete: the row goes. A new reply may be written straight after. */
  deleteReply(salon: SalonActor, now: Date): void {
    this.assertOwnedBy(salon);
    const reply = this.requireReply();
    this.p.reply = null;
    this._deletedReplyId = reply.id;
    this._replyChange = 'deleted';
    this.apply(
      new ReplyDeleted(this.id, this.subject.tenantId, now, {
        replyId: reply.id,
        storefrontId: this.subject.storefrontId,
      }),
    );
  }

  private requireReply(): Reply {
    if (this.p.reply === null) throw new DomainError('REPLY_NOT_FOUND');
    return this.p.reply;
  }

  // ─── moderation (HQ only; the salon has no path here) ───────────────────

  hide(by: string, note: unknown, now: Date): void {
    this.moveTo('HIDDEN', by, note, now, 'moderation', null);
  }

  /** HIDDEN -> PUBLISHED. Named unhide because restore() rehydrates. */
  unhide(by: string, note: unknown, now: Date): void {
    this.moveTo('PUBLISHED', by, note, now, 'moderation', null);
  }

  /** Final. A removed review never comes back and is never replaced. */
  remove(by: string, note: unknown, now: Date): void {
    this.moveTo('REMOVED', by, note, now, 'moderation', null);
  }

  /**
   * An upheld report takes the review down, recoverably.
   *
   * PUBLISHED becomes HIDDEN. A review already HIDDEN stays HIDDEN with the
   * new decision stamped on it. A REMOVED review stays REMOVED: removal is
   * final, and an uphold must not be a way to bring one back. (The platform's
   * adapter set HIDDEN unconditionally; nothing there could reach REMOVED, so
   * the difference never showed. See docs/DECISIONS.md.)
   */
  hideForUpheldReport(by: string, note: string, now: Date, reportId: string): ReviewState {
    if (this.p.state === 'PUBLISHED') {
      this.moveTo('HIDDEN', by, note, now, 'report_upheld', reportId);
    } else if (this.p.state === 'HIDDEN') {
      this.p.moderation = { byId: by, at: now, note: note.trim() };
    }
    return this.p.state;
  }

  private moveTo(
    to: ReviewState,
    by: string,
    note: unknown,
    now: Date,
    cause: ModerationCause,
    reportId: string | null,
  ): void {
    const errors = validateResolutionNote(note);
    if (errors.length > 0) throw DomainError.validation(errors);

    const from = this.p.state;
    if (!canTransition(from, to)) {
      throw new DomainError(
        'REVIEW_TRANSITION_INVALID',
        `A review that is ${from} cannot be moved to ${to}.`,
      );
    }
    this.p.state = to;
    this.p.moderation = { byId: by, at: now, note: (note as string).trim() };

    const data = {
      storefrontId: this.subject.storefrontId,
      from,
      to,
      moderatedById: by,
      cause,
      reportId,
    };
    const tenantId = this.subject.tenantId;
    if (to === 'HIDDEN') this.apply(new ReviewHidden(this.id, tenantId, now, data));
    else if (to === 'PUBLISHED') this.apply(new ReviewRestored(this.id, tenantId, now, data));
    else this.apply(new ReviewRemoved(this.id, tenantId, now, data));
  }

  // ─── erasure ────────────────────────────────────────────────────────────

  /** The person asked to be forgotten: the words stay, the name and link go. */
  eraseCustomer(): void {
    this.p.customerId = null;
    this.p.authorName = AuthorName.of('');
  }

  // ─── reads ──────────────────────────────────────────────────────────────

  get id() {
    return this.p.id;
  }
  get subject() {
    return this.p.subject;
  }
  get booking() {
    return this.p.booking;
  }
  get inviteId() {
    return this.p.inviteId;
  }
  get customerId() {
    return this.p.customerId;
  }
  get rating() {
    return this.p.rating;
  }
  get comment() {
    return this.p.comment;
  }
  get language() {
    return this.p.language;
  }
  get authorName() {
    return this.p.authorName;
  }
  get state() {
    return this.p.state;
  }
  get moderation() {
    return this.p.moderation;
  }
  get createdAt() {
    return this.p.createdAt;
  }
  get reply() {
    return this.p.reply;
  }
  get replyChange(): ReplyChange {
    return this._replyChange;
  }
  get deletedReplyId(): string | null {
    return this._deletedReplyId;
  }
  /** Shown and counted. PUBLISHED only. */
  get isVisible(): boolean {
    return isVisible(this.p.state);
  }
}
