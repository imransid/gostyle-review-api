import { Injectable } from '@nestjs/common';
import type { RatingSummary as Row } from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { asPrisma } from '../../../shared/prisma/prisma-tx';
import type {
  RatingSummaryRepository,
  SummaryKey,
  SummarySnapshot,
} from '../../domain/ports/rating-summary.repository';
import type { TxHandle } from '../../domain/ports/unit-of-work.port';
import { EMPTY_COUNTS, type RatingCounts } from '../../domain/rating/rating-summary';

const SUBJECT = 'STOREFRONT' as const;

function toSnapshot(r: Row): SummarySnapshot {
  return {
    storefrontId: r.subjectId,
    tenantId: r.tenantId,
    branchId: r.branchId,
    counts: {
      reviewCount: r.reviewCount,
      ratingSum: r.ratingSum,
      histogram: { '1': r.star1, '2': r.star2, '3': r.star3, '4': r.star4, '5': r.star5 },
      countByLanguage: { EN: r.countEn, AR: r.countAr },
    },
    version: r.version,
    updatedAt: r.updatedAt,
  };
}

interface CountRow {
  review_count: number;
  rating_sum: number;
  star_1: number;
  star_2: number;
  star_3: number;
  star_4: number;
  star_5: number;
  count_en: number;
  count_ar: number;
}

@Injectable()
export class PrismaRatingSummaryRepository implements RatingSummaryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async lock(key: SummaryKey, tx: TxHandle): Promise<SummarySnapshot> {
    const db = asPrisma(this.prisma, tx);
    await db.$executeRaw`
      INSERT INTO rating_summary (subject_type, subject_id, tenant_id, branch_id)
      VALUES (${SUBJECT}::rating_subject_type, ${key.storefrontId}::uuid,
              ${key.tenantId}::uuid, ${key.branchId}::uuid)
      ON CONFLICT (subject_type, subject_id) DO NOTHING`;
    const rows = await db.$queryRaw<Row[]>`
      SELECT subject_id AS "subjectId", tenant_id AS "tenantId", branch_id AS "branchId",
             review_count AS "reviewCount", rating_sum AS "ratingSum",
             star_1 AS "star1", star_2 AS "star2", star_3 AS "star3", star_4 AS "star4",
             star_5 AS "star5", count_en AS "countEn", count_ar AS "countAr",
             version, updated_at AS "updatedAt"
        FROM rating_summary
       WHERE subject_type = ${SUBJECT}::rating_subject_type AND subject_id = ${key.storefrontId}::uuid
         FOR UPDATE`;
    return toSnapshot(rows[0]);
  }

  async countVisible(storefrontId: string, tx?: TxHandle): Promise<RatingCounts> {
    // PUBLISHED ONLY, and this is the one place that says so for the stored
    // summary: the same rule the platform's findRatingsForAggregate held.
    const rows = await asPrisma(this.prisma, tx).$queryRaw<CountRow[]>`
      SELECT count(*)::int                                   AS review_count,
             coalesce(sum(rating), 0)::int                   AS rating_sum,
             count(*) FILTER (WHERE rating = 1)::int         AS star_1,
             count(*) FILTER (WHERE rating = 2)::int         AS star_2,
             count(*) FILTER (WHERE rating = 3)::int         AS star_3,
             count(*) FILTER (WHERE rating = 4)::int         AS star_4,
             count(*) FILTER (WHERE rating = 5)::int         AS star_5,
             count(*) FILTER (WHERE language = 'EN')::int    AS count_en,
             count(*) FILTER (WHERE language = 'AR')::int    AS count_ar
        FROM review
       WHERE storefront_id = ${storefrontId}::uuid AND state = 'PUBLISHED'`;
    const r = rows[0];
    if (!r) return EMPTY_COUNTS;
    return {
      reviewCount: r.review_count,
      ratingSum: r.rating_sum,
      histogram: { '1': r.star_1, '2': r.star_2, '3': r.star_3, '4': r.star_4, '5': r.star_5 },
      countByLanguage: { EN: r.count_en, AR: r.count_ar },
    };
  }

  async replace(
    key: SummaryKey,
    c: RatingCounts,
    opts: { recomputed: boolean },
    tx: TxHandle,
  ): Promise<SummarySnapshot> {
    const now = new Date();
    const row = await asPrisma(this.prisma, tx).ratingSummary.update({
      where: { subjectType_subjectId: { subjectType: SUBJECT, subjectId: key.storefrontId } },
      data: {
        reviewCount: c.reviewCount,
        ratingSum: c.ratingSum,
        star1: c.histogram['1'],
        star2: c.histogram['2'],
        star3: c.histogram['3'],
        star4: c.histogram['4'],
        star5: c.histogram['5'],
        countEn: c.countByLanguage.EN,
        countAr: c.countByLanguage.AR,
        version: { increment: 1 },
        updatedAt: now,
        ...(opts.recomputed ? { lastRecomputedAt: now } : {}),
      },
    });
    return toSnapshot(row);
  }

  async touchRecomputed(key: SummaryKey, tx: TxHandle): Promise<void> {
    await asPrisma(this.prisma, tx).ratingSummary.update({
      where: { subjectType_subjectId: { subjectType: SUBJECT, subjectId: key.storefrontId } },
      data: { lastRecomputedAt: new Date() },
    });
  }

  async listSubjects(tx?: TxHandle): Promise<SummaryKey[]> {
    // Every storefront that has reviews, and every summary row (a storefront
    // whose last review was removed still has a row that must go to zero).
    const rows = await asPrisma(this.prisma, tx).$queryRaw<
      { storefront_id: string; tenant_id: string; branch_id: string }[]
    >`
      SELECT storefront_id, tenant_id, branch_id FROM (
        SELECT DISTINCT ON (storefront_id) storefront_id, tenant_id, branch_id
          FROM review ORDER BY storefront_id, created_at DESC
      ) r
      UNION
      SELECT subject_id, tenant_id, branch_id FROM rating_summary
       WHERE subject_type = ${SUBJECT}::rating_subject_type`;
    return rows.map((r) => ({
      storefrontId: r.storefront_id,
      tenantId: r.tenant_id,
      branchId: r.branch_id,
    }));
  }
}
