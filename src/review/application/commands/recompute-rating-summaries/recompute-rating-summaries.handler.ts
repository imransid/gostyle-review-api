import { Inject, Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import {
  RATING_SUMMARY_REPOSITORY,
  type RatingSummaryRepository,
} from '../../../domain/ports/rating-summary.repository';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../domain/ports/unit-of-work.port';
import { describe, RatingProjector } from '../../rating/rating-projector';
import { RecomputeRatingSummariesCommand } from './recompute-rating-summaries.command';

export interface RecomputeResult {
  checked: number;
  repaired: number;
  differences: { storefrontId: string; stored: string; actual: string }[];
}

/**
 * The drift guard: recount every storefront from its rows, log any difference
 * and repair it. One short transaction per storefront, each under the
 * summary's lock, so the check never races a review landing at the same time
 * and never holds more than one storefront still.
 */
@CommandHandler(RecomputeRatingSummariesCommand)
export class RecomputeRatingSummariesHandler
  implements ICommandHandler<RecomputeRatingSummariesCommand, RecomputeResult>
{
  private static readonly log = new Logger(RecomputeRatingSummariesHandler.name);

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(RATING_SUMMARY_REPOSITORY) private readonly summaries: RatingSummaryRepository,
    private readonly projector: RatingProjector,
  ) {}

  async execute(cmd: RecomputeRatingSummariesCommand): Promise<RecomputeResult> {
    const subjects = await this.summaries.listSubjects();
    const differences: RecomputeResult['differences'] = [];
    for (const key of subjects) {
      const diff = await this.uow.run((tx) => this.projector.recompute(key, tx));
      if (diff) {
        const d = {
          storefrontId: key.storefrontId,
          stored: describe(diff.stored),
          actual: describe(diff.actual),
        };
        differences.push(d);
        RecomputeRatingSummariesHandler.log.warn(
          `rating_summary drift repaired for storefront ${d.storefrontId}: stored ${d.stored}, rows ${d.actual}`,
        );
      }
    }
    RecomputeRatingSummariesHandler.log.log(
      `recompute (${cmd.input.trigger}): ${subjects.length} checked, ${differences.length} repaired`,
    );
    return { checked: subjects.length, repaired: differences.length, differences };
  }
}
