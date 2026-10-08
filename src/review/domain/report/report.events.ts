import { DomainEvent } from '../shared/domain-event';

abstract class ReportEvent extends DomainEvent {
  readonly aggregateType = 'review_report';
}

/** Filed. Changes NOTHING the public sees. Audit and HQ queue counts. */
export class ReportFiled extends ReportEvent {
  readonly type = 'review.report.filed.v1';
  constructor(
    reportId: string,
    tenantId: string,
    at: Date,
    private readonly data: { reviewId: string; reason: string; reportedById: string },
  ) {
    super(reportId, tenantId, at);
  }
  payload() {
    return { reportId: this.aggregateId, ...this.data };
  }
}

export class ReportUpheld extends ReportEvent {
  readonly type = 'review.report.upheld.v1';
  constructor(
    reportId: string,
    tenantId: string,
    at: Date,
    private readonly data: { reviewId: string; resolvedById: string },
  ) {
    super(reportId, tenantId, at);
  }
  payload() {
    return { reportId: this.aggregateId, ...this.data };
  }
}

export class ReportDismissed extends ReportEvent {
  readonly type = 'review.report.dismissed.v1';
  constructor(
    reportId: string,
    tenantId: string,
    at: Date,
    private readonly data: { reviewId: string; resolvedById: string },
  ) {
    super(reportId, tenantId, at);
  }
  payload() {
    return { reportId: this.aggregateId, ...this.data };
  }
}
