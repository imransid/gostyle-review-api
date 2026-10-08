import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { PrismaService } from '../../../../shared/prisma/prisma.service';
import type { ReportReason, ReportStatus } from '../../../domain/services/review-report-rules';
import {
  REVIEW_STATES,
  type ReviewAggregate,
  type ReviewLanguage,
  type ReviewState,
} from '../../../domain/services/review-rules';
import type { ReviewReplyView } from '../../views';
import { aggregateOf, iso, page, shownName } from '../views';
import { ListConsoleReviewsQuery } from './list-console-reviews.query';

/** The platform's StorefrontReviewView, unchanged. */
export interface ConsoleReviewView {
  id: string;
  rating: number;
  comment: string | null;
  language: ReviewLanguage;
  authorDisplayName: string;
  state: ReviewState;
  createdAt: string;
  reply: ReviewReplyView | null;
  reports: {
    id: string;
    reason: ReportReason;
    note: string | null;
    status: ReportStatus;
    createdAt: string;
    resolvedAt: string | null;
    resolutionNote: string | null;
  }[];
}

export interface ConsoleReviewsPage {
  data: ConsoleReviewView[];
  total: number;
  offset: number;
  limit: number;
  /** Over VISIBLE reviews only, whatever page or state filter is read. */
  summary: ReviewAggregate;
}

/**
 * The salon's reviews screen (the platform's ListStorefrontReviewsHandler):
 * EVERY STATE by default, because the salon must see what was hidden; newest
 * first; each with its reply and its full report history; and the summary of
 * what the public sees beside it. One query per concern, never per row.
 */
@QueryHandler(ListConsoleReviewsQuery)
export class ListConsoleReviewsHandler implements IQueryHandler<ListConsoleReviewsQuery, ConsoleReviewsPage> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(q: ListConsoleReviewsQuery): Promise<ConsoleReviewsPage> {
    const i = q.input;
    const { offset, limit } = page(i.offset, i.limit);
    // An unknown state is ignored, not refused: a typo in a query param shows
    // the unfiltered list rather than a 422 on a screen opened to read.
    const state = (REVIEW_STATES as readonly string[]).includes(i.state ?? '') ? (i.state as ReviewState) : undefined;
    const where = { tenantId: i.tenantId, branchId: i.branchId, ...(state ? { state } : {}) };

    const [rows, total, summary] = await Promise.all([
      this.prisma.review.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: limit,
        include: {
          reply: true,
          reports: { orderBy: { createdAt: 'desc' } },
        },
      }),
      this.prisma.review.count({ where }),
      this.prisma.ratingSummary.findFirst({
        where: { subjectType: 'STOREFRONT', tenantId: i.tenantId, branchId: i.branchId },
      }),
    ]);

    return {
      data: rows.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        language: r.language,
        authorDisplayName: shownName(r.authorDisplayName),
        state: r.state,
        createdAt: r.createdAt.toISOString(),
        reply: r.reply
          ? {
              reviewId: r.id,
              body: r.reply.body,
              createdAt: r.reply.createdAt.toISOString(),
              editedAt: iso(r.reply.editedAt),
            }
          : null,
        reports: r.reports.map((rep) => ({
          id: rep.id,
          reason: rep.reason,
          note: rep.note,
          status: rep.status,
          createdAt: rep.createdAt.toISOString(),
          resolvedAt: iso(rep.resolvedAt),
          resolutionNote: rep.resolutionNote,
        })),
      })),
      total,
      offset,
      limit,
      summary: aggregateOf(summary),
    };
  }
}
