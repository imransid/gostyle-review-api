import type { ReviewReport } from '../report/review-report.aggregate';
import type { ReportStatus } from '../services/review-report-rules';
import type { TxHandle } from './unit-of-work.port';

export const REVIEW_REPORT_REPOSITORY = Symbol('REVIEW_REPORT_REPOSITORY');

export interface ReviewReportRepository {
  /**
   * File a report. A second OPEN report on the same review violates the
   * partial unique index and is reported as REPORT_ALREADY_OPEN. Not a
   * pre-read: check-then-insert loses the race between two managers.
   */
  insert(report: ReviewReport, tx?: TxHandle): Promise<void>;

  /** Any tenant: the HQ queue is across every salon. */
  findById(id: string, tx?: TxHandle): Promise<ReviewReport | null>;

  /**
   * Write a resolution, compare-and-set against `expected`. False when a
   * second reviewer decided it first.
   */
  saveResolution(report: ReviewReport, expected: ReportStatus, tx?: TxHandle): Promise<boolean>;
}
