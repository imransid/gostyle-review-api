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
import { CLOCK, type Clock } from '../../clock';
import { recordEvents } from '../../record-events';
import type { ReportDecisionView } from '../../views';
import { DismissReportCommand } from '../uphold-report/report-decisions';
import { staleReport, toDecisionView } from '../uphold-report/uphold-report.handler';

/**
 * HQ disagrees. THE REVIEW IS NOT TOUCHED: not its state, not its stamp, not
 * its place in the average. Filing never changed it, so there is nothing to
 * reset.
 */
@CommandHandler(DismissReportCommand)
export class DismissReportHandler implements ICommandHandler<DismissReportCommand, ReportDecisionView> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(REVIEW_REPORT_REPOSITORY) private readonly reports: ReviewReportRepository,
    @Inject(REVIEW_REPOSITORY) private readonly reviews: ReviewRepository,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  execute(cmd: DismissReportCommand): Promise<ReportDecisionView> {
    const now = this.clock.now();
    const i = cmd.input;
    return this.uow.run(async (tx) => {
      const report = await this.reports.findById(i.reportId, tx);
      if (!report) throw new DomainError('REPORT_NOT_FOUND');
      const before = report.status;
      report.dismiss(i.reviewerId, i.note, now);
      if (!(await this.reports.saveResolution(report, before, tx))) throw staleReport();
      await recordEvents(this.outbox, tx, report);
      // The review's state as it ALREADY WAS.
      const review = await this.reviews.findById(report.reviewId, tx);
      return toDecisionView(report, review?.state ?? 'PUBLISHED');
    });
  }
}
