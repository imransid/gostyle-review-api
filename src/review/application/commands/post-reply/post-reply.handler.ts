import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { OUTBOX_WRITER, type OutboxWriter } from '../../../../shared/outbox/outbox.port';
import { DomainError } from '../../../domain/domain.error';
import { REVIEW_REPOSITORY, type ReviewRepository } from '../../../domain/ports/review.repository';
import { UNIT_OF_WORK, type TxHandle, type UnitOfWork } from '../../../domain/ports/unit-of-work.port';
import type { Review, SalonActor } from '../../../domain/review/review.aggregate';
import { CLOCK, type Clock } from '../../clock';
import { recordEvents } from '../../record-events';
import { toReplyView, type ReviewReplyView } from '../../views';
import { PostReplyCommand, type SalonInput } from './reply-commands';

/**
 * The ownership walk every salon-side write on a review performs, shared so a
 * check that exists in four handlers cannot end up existing in three: load the
 * review WITH the salon's tenant and branch in the WHERE, 404 otherwise.
 */
export async function loadForSalon(
  reviews: ReviewRepository,
  i: SalonInput,
  tx: TxHandle,
): Promise<{ review: Review; salon: SalonActor }> {
  const salon = { tenantId: i.tenantId, branchId: i.branchId, userId: i.actorId };
  const review = await reviews.findForSalon(i.reviewId, salon, tx);
  if (!review) throw new DomainError('REVIEW_NOT_FOUND');
  return { review, salon };
}

/**
 * The salon answers a review, once. A second reply is a 409, never an
 * overwrite: two managers with the screen open must not erase each other.
 */
@CommandHandler(PostReplyCommand)
export class PostReplyHandler implements ICommandHandler<PostReplyCommand, ReviewReplyView> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(REVIEW_REPOSITORY) private readonly reviews: ReviewRepository,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  execute(cmd: PostReplyCommand): Promise<ReviewReplyView> {
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const { review, salon } = await loadForSalon(this.reviews, cmd.input, tx);
      const reply = review.postReply(salon, cmd.input.body, now);
      await this.reviews.saveReply(review, tx);
      await recordEvents(this.outbox, tx, review);
      return toReplyView(review.id, reply);
    });
  }
}
