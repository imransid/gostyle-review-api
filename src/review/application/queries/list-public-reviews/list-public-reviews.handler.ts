import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { PrismaService } from '../../../../shared/prisma/prisma.service';
import { REVIEW_LANGUAGES, type ReviewLanguage } from '../../../domain/services/review-rules';
import { iso, page, shownName } from '../views';
import { ListPublicReviewsQuery } from './list-public-reviews.query';

export interface PublicReviewView {
  id: string;
  rating: number;
  comment: string | null;
  language: ReviewLanguage;
  authorDisplayName: string;
  createdAt: string;
  /** "Response from the salon": the body and dates, never the staff member. */
  reply: { body: string; createdAt: string; editedAt: string | null } | null;
}

export interface PublicReviewsPage {
  data: PublicReviewView[];
  total: number;
  offset: number;
  limit: number;
}

/** The storefront's public reviews: PUBLISHED only, newest first, paged. */
@QueryHandler(ListPublicReviewsQuery)
export class ListPublicReviewsHandler implements IQueryHandler<ListPublicReviewsQuery, PublicReviewsPage> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(q: ListPublicReviewsQuery): Promise<PublicReviewsPage> {
    const { offset, limit } = page(q.input.offset, q.input.limit);
    const language = (REVIEW_LANGUAGES as readonly string[]).includes(q.input.language ?? '')
      ? (q.input.language as ReviewLanguage)
      : undefined;
    // PUBLISHED, and only PUBLISHED: hidden and removed reviews are not shown.
    const where = { storefrontId: q.input.storefrontId, state: 'PUBLISHED' as const, ...(language ? { language } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: limit,
        select: {
          id: true,
          rating: true,
          comment: true,
          language: true,
          authorDisplayName: true,
          createdAt: true,
          reply: { select: { body: true, createdAt: true, editedAt: true } },
        },
      }),
      this.prisma.review.count({ where }),
    ]);
    return {
      data: rows.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        language: r.language,
        authorDisplayName: shownName(r.authorDisplayName),
        createdAt: r.createdAt.toISOString(),
        reply: r.reply
          ? { body: r.reply.body, createdAt: r.reply.createdAt.toISOString(), editedAt: iso(r.reply.editedAt) }
          : null,
      })),
      total,
      offset,
      limit,
    };
  }
}
