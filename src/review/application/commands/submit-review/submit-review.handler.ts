import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { OUTBOX_WRITER, type OutboxWriter } from '../../../../shared/outbox/outbox.port';
import { DomainError } from '../../../domain/domain.error';
import { CONTACT_DIRECTORY, type ContactDirectory } from '../../../domain/ports/contact-directory.port';
import {
  REVIEW_INVITE_REPOSITORY,
  type ReviewInviteRepository,
} from '../../../domain/ports/review-invite.repository';
import { REVIEW_REPOSITORY, type ReviewRepository } from '../../../domain/ports/review.repository';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../domain/ports/unit-of-work.port';
import { Review } from '../../../domain/review/review.aggregate';
import { checkReviewSubmission } from '../../../domain/services/review-rules';
import { AuthorName } from '../../../domain/value-objects/author-name';
import { Comment } from '../../../domain/value-objects/comment';
import { InviteToken } from '../../../domain/value-objects/invite-token';
import { Rating } from '../../../domain/value-objects/rating';
import { ReviewLanguage } from '../../../domain/value-objects/review-language';
import { CLOCK, type Clock } from '../../clock';
import { recordEvents } from '../../record-events';
import { RatingProjector } from '../../rating/rating-projector';
import { SubmitReviewCommand } from './submit-review.command';

export interface SubmitReviewResult {
  reviewId: string;
}

/**
 * Write a review, authorised by an invite token and nothing else (the
 * platform's SubmitReviewHandler).
 *
 * NO SESSION, NO TENANT FROM THE REQUEST. Tenant, salon, booking and customer
 * all come back from the invite row.
 *
 * SINGLE USE IS ENFORCED THREE TIMES:
 *   1. refusal() gives the customer the accurate reason (404 / 410 / 409);
 *   2. markUsed() is a conditional update inside the transaction, the real
 *      guarantee: of two concurrent redemptions only one flips the row;
 *   3. UNIQUE (booking_source, booking_id) on review backstops both.
 */
@CommandHandler(SubmitReviewCommand)
export class SubmitReviewHandler implements ICommandHandler<SubmitReviewCommand, SubmitReviewResult> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(REVIEW_INVITE_REPOSITORY) private readonly invites: ReviewInviteRepository,
    @Inject(REVIEW_REPOSITORY) private readonly reviews: ReviewRepository,
    @Inject(CONTACT_DIRECTORY) private readonly contacts: ContactDirectory,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    private readonly projector: RatingProjector,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(cmd: SubmitReviewCommand): Promise<SubmitReviewResult> {
    const i = cmd.input;
    const now = this.clock.now();

    // ─── 1. By HASH. The plaintext never reaches storage or a log line.
    const invite = await this.invites.findByTokenHash(InviteToken.hashOf(String(i.token ?? '')));
    if (!invite) throw new DomainError('INVITE_NOT_FOUND');
    const refusal = invite.refusal(now);
    if (refusal !== null) throw new DomainError(refusal);

    // ─── 2. The name, read NOW and copied. The booking's name wins over a
    //        typed one; a booking with none lets the reviewer supply theirs.
    const contact = await this.contacts.find({
      bookingSource: invite.booking.source,
      customerId: invite.customerId,
    });
    const { errors, normalized } = checkReviewSubmission(
      {
        rating: i.rating,
        comment: i.comment,
        language: i.language,
        authorDisplayName: i.authorDisplayName,
      },
      contact?.displayName ?? null,
    );
    if (errors.length > 0) throw DomainError.validation(errors);

    const review = Review.submit({
      invite: {
        id: invite.id,
        subject: invite.subject,
        booking: invite.booking,
        customerId: invite.customerId,
      },
      rating: Rating.of(normalized.rating),
      comment: Comment.of(normalized.comment),
      language: ReviewLanguage.of(normalized.language),
      authorName: AuthorName.of(normalized.authorDisplayName),
      now,
    });

    // ─── 3. ONE TRANSACTION: invite spent, review written, summary moved,
    //        events recorded. Never a used invite without a review.
    await this.uow.run(async (tx) => {
      const won = await this.invites.markUsed(invite.id, now, tx);
      // Lost the race, or it expired between the read and the write.
      if (!won) throw new DomainError('INVITE_ALREADY_USED');
      await this.reviews.insert(review, tx);
      await this.projector.onReviewChange(
        {
          storefrontId: review.subject.storefrontId,
          tenantId: review.subject.tenantId,
          branchId: review.subject.branchId,
        },
        { rating: review.rating.value, language: review.language.value },
        null,
        review.state,
        tx,
      );
      await recordEvents(this.outbox, tx, review);
    });

    return { reviewId: review.id };
  }
}
