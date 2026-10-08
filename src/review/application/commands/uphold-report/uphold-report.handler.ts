import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { OUTBOX_WRITER, type OutboxWriter } from '../../../../shared/outbox/outbox.port';
import { DomainError } from '../../../domain/domain.error';
import {
  REVIEW_REPORT_REPOSITORY,
  type ReviewReportRepository,
} from '../../../domain/ports/review-report.repository';
import { REVIEW_REPOSITORY, type ReviewRepository } from '../../../domain/ports/review.repository';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../domain/ports/unit-of-work.port';
import type { ReviewReport } from '../../../domain/report/review-report.aggregate';
import type { ReviewState } from '../../../domain/review/review-state';
import { CLOCK, type Clock } from '../../clock';
import { RatingProjector } from '../../rating/rating-projector';
import { recordEvents } from '../../record-events';
import type { ReportDecisionView } from '../../views';
import { UpholdReportCommand } from './report-decisions';

export function toDecisionView(report: ReviewReport, reviewState: ReviewState): ReportDecisionView {
  return {
    id: report.id,
    tenantId: report.tenantId,
    reviewId: report.reviewId,
    status: report.status,
    resolvedById: report.resolvedById,
    resolvedAt: report.resolvedAt?.toISOString() ?? null,
    resolutionNote: report.resolutionNote,
    reviewState,
  };
}

export function staleReport(): DomainError {
  return new DomainError(
    'REPORT_TRANSITION_INVALID',
    'The report changed while you were deciding it. Reload the queue and try again.',
  );
}

/**
 * HQ agrees: the review comes down. THE ONLY PATH THAT HIDES A REVIEW BECAUSE
 * OF A REPORT, and both writes are one transaction: an upheld report whose
 * review is still visible, or a hidden review with no upheld report, is a
 * defect either way. HIDDEN, not REMOVED: a decision made from a queue should
 * be reversible.
 */
@CommandHandler(UpholdReportCommand)
export class UpholdReportHandler implements ICommandHandler<UpholdReportCommand, ReportDecisionView> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(REVIEW_REPORT_REPOSITORY) private readonly reports: ReviewReportRepository,
    @Inject(REVIEW_REPOSITORY) private readonly reviews: ReviewRepository,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    private readonly projector: RatingProjector,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  execute(cmd: UpholdReportCommand): Promise<ReportDecisionView> {
    const now = this.clock.now();
    const i = cmd.input;
    return this.uow.run(async (tx) => {
      const report = await this.reports.findById(i.reportId, tx);
      if (!report) throw new DomainError('REPORT_NOT_FOUND');
      const review = await this.reviews.findById(report.reviewId, tx);
      if (!review) throw new DomainError('REPORT_NOT_FOUND');

      const reportBefore = report.status;
      report.uphold(i.reviewerId, i.note, now);
      if (!(await this.reports.saveResolution(report, reportBefore, tx))) throw staleReport();

      const before = review.state;
      const after = review.hideForUpheldReport(i.reviewerId, report.resolutionNote!, now, report.id);
      if (before !== 'REMOVED') {
        // A review that moved under us rolls the resolution back with it.
        if (!(await this.reviews.saveState(review, before, tx))) throw staleReport();
      }
      await this.projector.onReviewChange(
        {
          storefrontId: review.subject.storefrontId,
          tenantId: review.subject.tenantId,
          branchId: review.subject.branchId,
        },
        { rating: review.rating.value, language: review.language.value },
        before,
        after,
        tx,
      );
      await recordEvents(this.outbox, tx, report, review);
      return toDecisionView(report, after);
    });
  }
}
