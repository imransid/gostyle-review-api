import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { OUTBOX_WRITER, type OutboxWriter } from '../../../../shared/outbox/outbox.port';
import { REVIEW_REPOSITORY, type ReviewRepository } from '../../../domain/ports/review.repository';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../domain/ports/unit-of-work.port';
import { CLOCK, type Clock } from '../../clock';
import { recordEvents } from '../../record-events';
import { loadForSalon } from '../post-reply/post-reply.handler';
import { DeleteReplyCommand } from '../post-reply/reply-commands';

/** HARD delete: the row is gone, and a new reply may be written straight away. */
@CommandHandler(DeleteReplyCommand)
export class DeleteReplyHandler implements ICommandHandler<DeleteReplyCommand, void> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(REVIEW_REPOSITORY) private readonly reviews: ReviewRepository,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  execute(cmd: DeleteReplyCommand): Promise<void> {
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const { review, salon } = await loadForSalon(this.reviews, cmd.input, tx);
      review.deleteReply(salon, now);
      await this.reviews.saveReply(review, tx);
      await recordEvents(this.outbox, tx, review);
    });
  }
}
