import { AggregateRoot } from '@nestjs/cqrs';
import { DomainError } from '../domain.error';
import {
  canResolverTransition,
  checkReportSubmission,
  validateResolutionNote,
  type ReportReason,
  type ReportStatus,
} from '../services/review-report-rules';
import { uuidv7 } from '../shared/uuidv7';
import { ReportDismissed, ReportFiled, ReportUpheld } from './report.events';

interface ReportProps {
  id: string;
  tenantId: string;
  reviewId: string;
  reason: ReportReason;
  note: string | null;
  status: ReportStatus;
  reportedById: string;
  resolvedById: string | null;
  resolvedAt: Date | null;
  resolutionNote: string | null;
  createdAt: Date;
}

/**
 * A salon's claim that a review should not stand.
 *
 * REPORTING IS NOT MODERATION. Filing writes this row and nothing else: the
 * review stays PUBLISHED, visible and counted. Only HQ decides, and only an
 * UPHELD decision hides the review (the handler applies that to the Review in
 * the same transaction). At most one OPEN report per review is a partial
 * unique index, not a read-then-write here.
 */
export class ReviewReport extends AggregateRoot {
  /** The status as loaded: resolution is compare-and-set against it. */
  readonly loadedStatus: ReportStatus | null;

  private constructor(
    private readonly p: ReportProps,
    loaded: boolean,
  ) {
    super();
    this.loadedStatus = loaded ? p.status : null;
  }

  static file(input: {
    review: { id: string; tenantId: string };
    reason: unknown;
    note: unknown;
    reportedById: string;
    now: Date;
    id?: string;
  }): ReviewReport {
    const { errors, normalized } = checkReportSubmission({
      reason: input.reason,
      note: input.note,
    });
    if (errors.length > 0) throw DomainError.validation(errors);

    const report = new ReviewReport(
      {
        id: input.id ?? uuidv7(input.now.getTime()),
        tenantId: input.review.tenantId,
        reviewId: input.review.id,
        reason: normalized.reason,
        note: normalized.note,
        status: 'OPEN',
        reportedById: input.reportedById,
        resolvedById: null,
        resolvedAt: null,
        resolutionNote: null,
        createdAt: input.now,
      },
      false,
    );
    report.apply(
      new ReportFiled(report.id, report.tenantId, input.now, {
        reviewId: report.reviewId,
        reason: report.reason,
        reportedById: report.reportedById,
      }),
    );
    return report;
  }

  static restore(p: ReportProps): ReviewReport {
    return new ReviewReport(p, true);
  }

  /** HQ agrees. The caller hides the review in the same transaction. */
  uphold(reviewerId: string, note: unknown, now: Date): void {
    this.resolve('UPHELD', reviewerId, note, now);
    this.apply(
      new ReportUpheld(this.id, this.tenantId, now, {
        reviewId: this.reviewId,
        resolvedById: reviewerId,
      }),
    );
  }

  /** HQ disagrees. The review is not touched at all. */
  dismiss(reviewerId: string, note: unknown, now: Date): void {
    this.resolve('DISMISSED', reviewerId, note, now);
    this.apply(
      new ReportDismissed(this.id, this.tenantId, now, {
        reviewId: this.reviewId,
        resolvedById: reviewerId,
      }),
    );
  }

  /**
   * The resolver's half of the state machine (canResolverTransition, never
   * the reporter's empty one). The note is required on BOTH outcomes.
   */
  private resolve(to: 'UPHELD' | 'DISMISSED', reviewerId: string, note: unknown, now: Date) {
    const errors = validateResolutionNote(note);
    if (errors.length > 0) throw DomainError.validation(errors);
    if (!canResolverTransition(this.p.status, to)) {
      throw new DomainError(
        'REPORT_TRANSITION_INVALID',
        `A report that is ${this.p.status} cannot be moved to ${to}.`,
      );
    }
    this.p.status = to;
    this.p.resolvedById = reviewerId;
    this.p.resolvedAt = now;
    this.p.resolutionNote = (note as string).trim();
  }

  get id() {
    return this.p.id;
  }
  get tenantId() {
    return this.p.tenantId;
  }
  get reviewId() {
    return this.p.reviewId;
  }
  get reason() {
    return this.p.reason;
  }
  get note() {
    return this.p.note;
  }
  get status() {
    return this.p.status;
  }
  get reportedById() {
    return this.p.reportedById;
  }
  get resolvedById() {
    return this.p.resolvedById;
  }
  get resolvedAt() {
    return this.p.resolvedAt;
  }
  get resolutionNote() {
    return this.p.resolutionNote;
  }
  get createdAt() {
    return this.p.createdAt;
  }
}
