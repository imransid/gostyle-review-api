import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import type { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../../shared/prisma/prisma.service';
import { DomainError } from '../../../domain/domain.error';
import {
  OPEN_REPORT_STATUS,
  REPORT_STATUSES,
  type ReportReason,
  type ReportStatus,
} from '../../../domain/services/review-report-rules';
import type { ReviewLanguage, ReviewState } from '../../../domain/services/review-rules';
import { iso, page, shownName } from '../views';
import { GetReportQuery, ListReportQueueQuery } from './report-queue.query';

/** The platform's ReviewReportQueueItem, plus the storefront and branch ids. */
export interface ReportQueueItem {
  id: string;
  tenantId: string;
  salonName: string;
  storefrontSlug: string;
  storefrontId: string;
  branchId: string;
  reason: ReportReason;
  note: string | null;
  status: ReportStatus;
  reportedById: string;
  createdAt: string;
  resolvedById: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  /** The words under complaint, IN THE ROW: "this is spam" needs the text. */
  review: {
    id: string;
    rating: number;
    comment: string | null;
    language: ReviewLanguage;
    authorDisplayName: string;
    state: ReviewState;
    createdAt: string;
  };
}

const INCLUDE = {
  review: { include: { invite: { select: { salonName: true, storefrontSlug: true } } } },
} satisfies Prisma.ReviewReportInclude;

type Row = Prisma.ReviewReportGetPayload<{ include: typeof INCLUDE }>;

function toItem(r: Row): ReportQueueItem {
  return {
    id: r.id,
    tenantId: r.tenantId,
    // Display snapshots taken at mint time (DECISIONS D9); review-service has
    // no storefront table to join.
    salonName: r.review.invite.salonName ?? '',
    storefrontSlug: r.review.invite.storefrontSlug ?? '',
    storefrontId: r.review.storefrontId,
    branchId: r.review.branchId,
    reason: r.reason,
    note: r.note,
    status: r.status,
    reportedById: r.reportedById,
    createdAt: r.createdAt.toISOString(),
    resolvedById: r.resolvedById,
    resolvedAt: iso(r.resolvedAt),
    resolutionNote: r.resolutionNote,
    review: {
      id: r.review.id,
      rating: r.review.rating,
      comment: r.review.comment,
      language: r.review.language,
      // What the PUBLIC sees: a blank stored name reads "Verified customer".
      authorDisplayName: shownName(r.review.authorDisplayName),
      state: r.review.state,
      createdAt: r.review.createdAt.toISOString(),
    },
  };
}

/**
 * The HQ queue, across every salon: OLDEST FIRST, because it is a work queue.
 * Defaults to OPEN, and an unknown status falls back to OPEN rather than to
 * everything (the platform's rule).
 *
 * One of the cross-tenant reads, reachable only from the HQ controller.
 */
@QueryHandler(ListReportQueueQuery)
export class ListReportQueueHandler
  implements IQueryHandler<ListReportQueueQuery, { data: ReportQueueItem[]; total: number; offset: number; limit: number }>
{
  constructor(private readonly prisma: PrismaService) {}

  async execute(q: ListReportQueueQuery) {
    const { offset, limit } = page(q.input.offset, q.input.limit);
    const status: ReportStatus = (REPORT_STATUSES as readonly string[]).includes(q.input.status ?? '')
      ? (q.input.status as ReportStatus)
      : OPEN_REPORT_STATUS;
    const [rows, total] = await Promise.all([
      this.prisma.reviewReport.findMany({
        where: { status },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: offset,
        take: limit,
        include: INCLUDE,
      }),
      this.prisma.reviewReport.count({ where: { status } }),
    ]);
    return { data: rows.map(toItem), total, offset, limit };
  }
}

@QueryHandler(GetReportQuery)
export class GetReportHandler implements IQueryHandler<GetReportQuery, ReportQueueItem> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(q: GetReportQuery): Promise<ReportQueueItem> {
    const row = await this.prisma.reviewReport.findUnique({ where: { id: q.reportId }, include: INCLUDE });
    if (!row) throw new DomainError('REPORT_NOT_FOUND');
    return toItem(row);
  }
}
