import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { OUTBOX_WRITER, type OutboxWriter } from '../../../../shared/outbox/outbox.port';
import { DomainError } from '../../../domain/domain.error';
import { REVIEW_REPOSITORY, type ReviewRepository } from '../../../domain/ports/review.repository';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../domain/ports/unit-of-work.port';
import type { Review } from '../../../domain/review/review.aggregate';
import { CLOCK, type Clock } from '../../clock';
import { RatingProjector } from '../../rating/rating-projector';
import { recordEvents } from '../../record-events';
import type { ModerationView } from '../../views';
import { HideReviewCommand, RemoveReviewCommand, RestoreReviewCommand } from './moderate-review.commands';

type Move = (review: Review, by: string, note: unknown, now: Date) => void;

/**
 * HQ moves a review between states. One transaction: the state (compare-and-
 * set against what was read), the summary, the event.
 */
abstract class ModerateReviewHandler {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly reviews: ReviewRepository,
    private readonly outbox: OutboxWriter,
    private readonly projector: RatingProjector,
    private readonly clock: Clock,
  ) {}

  protected moderate(
    i: { reviewId: string; moderatorId: string; note: unknown },
    move: Move,
  ): Promise<ModerationView> {
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const review = await this.reviews.findById(i.reviewId, tx);
      if (!review) throw new DomainError('REVIEW_NOT_FOUND');
      const before = review.state;
      move(review, i.moderatorId, i.note, now);
      if (!(await this.reviews.saveState(review, before, tx))) {
        throw new DomainError(
          'REVIEW_TRANSITION_INVALID',
          'The review changed while you were deciding. Reload and try again.',
        );
      }
      await this.projector.onReviewChange(
        {
          storefrontId: review.subject.storefrontId,
          tenantId: review.subject.tenantId,
          branchId: review.subject.branchId,
        },
        { rating: review.rating.value, language: review.language.value },
        before,
        review.state,
        tx,
      );
      await recordEvents(this.outbox, tx, review);
      const m = review.moderation!;
      return {
        reviewId: review.id,
        state: review.state,
        moderatedById: m.byId,
        moderatedAt: m.at.toISOString(),
        moderationNote: m.note,
      };
    });
  }
}

@CommandHandler(HideReviewCommand)
export class HideReviewHandler
  extends ModerateReviewHandler
  implements ICommandHandler<HideReviewCommand, ModerationView>
{
  constructor(
    @Inject(UNIT_OF_WORK) uow: UnitOfWork,
    @Inject(REVIEW_REPOSITORY) reviews: ReviewRepository,
    @Inject(OUTBOX_WRITER) outbox: OutboxWriter,
    projector: RatingProjector,
    @Inject(CLOCK) clock: Clock,
  ) {
    super(uow, reviews, outbox, projector, clock);
  }
  execute(cmd: HideReviewCommand) {
    return this.moderate(cmd.input, (r, by, note, now) => r.hide(by, note, now));
  }
}

@CommandHandler(RestoreReviewCommand)
export class RestoreReviewHandler
  extends ModerateReviewHandler
  implements ICommandHandler<RestoreReviewCommand, ModerationView>
{
  constructor(
    @Inject(UNIT_OF_WORK) uow: UnitOfWork,
    @Inject(REVIEW_REPOSITORY) reviews: ReviewRepository,
    @Inject(OUTBOX_WRITER) outbox: OutboxWriter,
    projector: RatingProjector,
    @Inject(CLOCK) clock: Clock,
  ) {
    super(uow, reviews, outbox, projector, clock);
  }
  execute(cmd: RestoreReviewCommand) {
    return this.moderate(cmd.input, (r, by, note, now) => r.unhide(by, note, now));
  }
}

@CommandHandler(RemoveReviewCommand)
export class RemoveReviewHandler
  extends ModerateReviewHandler
  implements ICommandHandler<RemoveReviewCommand, ModerationView>
{
  constructor(
    @Inject(UNIT_OF_WORK) uow: UnitOfWork,
    @Inject(REVIEW_REPOSITORY) reviews: ReviewRepository,
    @Inject(OUTBOX_WRITER) outbox: OutboxWriter,
    projector: RatingProjector,
    @Inject(CLOCK) clock: Clock,
  ) {
    super(uow, reviews, outbox, projector, clock);
  }
  execute(cmd: RemoveReviewCommand) {
    return this.moderate(cmd.input, (r, by, note, now) => r.remove(by, note, now));
  }
}
