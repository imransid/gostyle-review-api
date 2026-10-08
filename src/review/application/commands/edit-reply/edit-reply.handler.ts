import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { OUTBOX_WRITER, type OutboxWriter } from '../../../../shared/outbox/outbox.port';
import { REVIEW_REPOSITORY, type ReviewRepository } from '../../../domain/ports/review.repository';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../domain/ports/unit-of-work.port';
import { CLOCK, type Clock } from '../../clock';
import { recordEvents } from '../../record-events';
import { toReplyView, type ReviewReplyView } from '../../views';
import { loadForSalon } from '../post-reply/post-reply.handler';
import { EditReplyCommand } from '../post-reply/reply-commands';

/** A full replacement of the one reply. 404 when there is none to edit. */
@CommandHandler(EditReplyCommand)
export class EditReplyHandler implements ICommandHandler<EditReplyCommand, ReviewReplyView> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(REVIEW_REPOSITORY) private readonly reviews: ReviewRepository,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  execute(cmd: EditReplyCommand): Promise<ReviewReplyView> {
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const { review, salon } = await loadForSalon(this.reviews, cmd.input, tx);
      const reply = review.editReply(salon, cmd.input.body, now);
      await this.reviews.saveReply(review, tx);
      await recordEvents(this.outbox, tx, review);
      return toReplyView(review.id, reply);
    });
  }
}
