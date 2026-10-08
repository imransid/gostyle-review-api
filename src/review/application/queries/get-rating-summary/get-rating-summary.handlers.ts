import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { PrismaService } from '../../../../shared/prisma/prisma.service';
import type { ReviewAggregate } from '../../../domain/services/review-rules';
import { aggregateOf, countsOf } from '../views';
import {
  GetConsoleAggregateQuery,
  GetRatingSummariesQuery,
  GetRatingSummaryQuery,
} from './get-rating-summary.query';

/**
 * The public rating: { average, count, countByLanguage, histogram }.
 * From the STORED summary. A storefront nobody has reviewed has no row yet and
 * answers the empty aggregate: average null (never 0), every bar present.
 */
@QueryHandler(GetRatingSummaryQuery)
export class GetRatingSummaryHandler implements IQueryHandler<GetRatingSummaryQuery, ReviewAggregate> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(q: GetRatingSummaryQuery): Promise<ReviewAggregate> {
    const row = await this.prisma.ratingSummary.findUnique({
      where: { subjectType_subjectId: { subjectType: 'STOREFRONT', subjectId: q.storefrontId } },
    });
    return aggregateOf(row);
  }
}

@QueryHandler(GetConsoleAggregateQuery)
export class GetConsoleAggregateHandler implements IQueryHandler<GetConsoleAggregateQuery, ReviewAggregate> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(q: GetConsoleAggregateQuery): Promise<ReviewAggregate> {
    // Tenant AND branch: the JWT's tenant, so another salon's branch id finds nothing.
    const row = await this.prisma.ratingSummary.findFirst({
      where: { subjectType: 'STOREFRONT', tenantId: q.input.tenantId, branchId: q.input.branchId },
    });
    return aggregateOf(row);
  }
}

export interface RatingSummaryItem {
  storefrontId: string;
  tenantId: string;
  branchId: string;
  reviewCount: number;
  ratingSum: number;
  average: number | null;
  histogram: ReviewAggregate['histogram'];
  countByLanguage: ReviewAggregate['countByLanguage'];
  version: string;
  updatedAt: string;
}

export interface RatingSummariesPage {
  data: RatingSummaryItem[];
  /** Pass as `after` for the next page; null on the last one. */
  nextCursor: string | null;
}

/**
 * Summaries in the SAME shape rating.summary.changed.v1 carries, so a
 * backfill and the event stream write the same rows on customer-api's side.
 */
@QueryHandler(GetRatingSummariesQuery)
export class GetRatingSummariesHandler implements IQueryHandler<GetRatingSummariesQuery, RatingSummariesPage> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(q: GetRatingSummariesQuery): Promise<RatingSummariesPage> {
    const limit = Math.min(Math.max(q.input.limit ?? 200, 1), 500);
    const ids = q.input.storefrontIds;
    const rows = await this.prisma.ratingSummary.findMany({
      where: {
        subjectType: 'STOREFRONT',
        // By ids (no paging), or every row after the cursor.
        ...(ids ? { subjectId: { in: ids } } : q.input.after ? { subjectId: { gt: q.input.after } } : {}),
      },
      orderBy: { subjectId: 'asc' },
      take: ids ? undefined : limit + 1,
    });
    const pageRows = ids ? rows : rows.slice(0, limit);
    const data = pageRows.map((r) => {
      const a = aggregateOf(r);
      const c = countsOf(r);
      return {
        storefrontId: r.subjectId,
        tenantId: r.tenantId,
        branchId: r.branchId,
        reviewCount: c.reviewCount,
        ratingSum: c.ratingSum,
        average: a.average,
        histogram: a.histogram,
        countByLanguage: a.countByLanguage,
        version: r.version.toString(),
        updatedAt: r.updatedAt.toISOString(),
      };
    });
    const more = !ids && rows.length > limit;
    return { data, nextCursor: more ? pageRows[pageRows.length - 1].subjectId : null };
  }
}
