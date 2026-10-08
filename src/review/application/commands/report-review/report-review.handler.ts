import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { OUTBOX_WRITER, type OutboxWriter } from '../../../../shared/outbox/outbox.port';
import {
  REVIEW_REPORT_REPOSITORY,
  type ReviewReportRepository,
} from '../../../domain/ports/review-report.repository';
import { REVIEW_REPOSITORY, type ReviewRepository } from '../../../domain/ports/review.repository';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../domain/ports/unit-of-work.port';
import { ReviewReport } from '../../../domain/report/review-report.aggregate';
import { CLOCK, type Clock } from '../../clock';
import { recordEvents } from '../../record-events';
import type { ReviewReportFiledView } from '../../views';
import { loadForSalon } from '../post-reply/post-reply.handler';
import { ReportReviewCommand } from './report-review.command';

/**
 * A salon asks HQ to look at a review. THIS WRITES ONE ROW AND CHANGES NOTHING
 * ELSE: the review stays PUBLISHED, visible and counted. If reporting hid the
 * review, a salon could suppress every criticism with a button.
 */
@CommandHandler(ReportReviewCommand)
export class ReportReviewHandler implements ICommandHandler<ReportReviewCommand, ReviewReportFiledView> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(REVIEW_REPOSITORY) private readonly reviews: ReviewRepository,
    @Inject(REVIEW_REPORT_REPOSITORY) private readonly reports: ReviewReportRepository,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  execute(cmd: ReportReviewCommand): Promise<ReviewReportFiledView> {
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      // Ownership first: a foreign review is a 404 whatever the payload says.
      const { review } = await loadForSalon(this.reviews, cmd.input, tx);
      const report = ReviewReport.file({
        review: { id: review.id, tenantId: review.subject.tenantId },
        reason: cmd.input.reason,
        note: cmd.input.note,
        reportedById: cmd.input.actorId,
        now,
      });
      await this.reports.insert(report, tx);
      await recordEvents(this.outbox, tx, report);
      // The state as READ, not assumed: a review already hidden by an earlier
      // upheld report can be reported again.
      return { reportId: report.id, reviewId: review.id, status: report.status, reviewState: review.state };
    });
  }
}
