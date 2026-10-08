import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { RecomputeRatingSummariesCommand } from '../../src/review/application/commands/recompute-rating-summaries/recompute-rating-summaries.command';
import { SubmitReviewCommand } from '../../src/review/application/commands/submit-review/submit-review.command';
import { harness, resetTables, testPrisma, type Harness } from './harness';

const prisma = testPrisma();
let h: Harness;

beforeEach(async () => {
  await resetTables(prisma);
  h = harness(prisma);
});
afterAll(() => prisma.$disconnect());

const summaryOf = (storefrontId: string) =>
  prisma.ratingSummary.findUniqueOrThrow({
    where: { subjectType_subjectId: { subjectType: 'STOREFRONT', subjectId: storefrontId } },
  });

describe('rating_summary', () => {
  it('is updated in the same transaction as the review, with every count', async () => {
    const s = h.storefronts.add();
    await h.review(s, 5, 'EN');
    await h.review(s, 4, 'AR');
    await h.review(s, 4, 'EN');
    expect(await summaryOf(s.storefrontId)).toMatchObject({
      tenantId: s.tenantId,
      branchId: s.branchId,
      reviewCount: 3,
      ratingSum: 13,
      star1: 0,
      star2: 0,
      star3: 0,
      star4: 2,
      star5: 1,
      countEn: 2,
      countAr: 1,
    });
  });

  it('stays exact when twenty reviews land on one storefront at once', async () => {
    const s = h.storefronts.add();
    const tokens = await Promise.all(Array.from({ length: 20 }, () => h.invite(s)));
    await Promise.all(
      tokens.map(({ token }, i) =>
        h.submit.execute(new SubmitReviewCommand({ token, rating: (i % 5) + 1, language: i % 2 ? 'AR' : 'EN' })),
      ),
    );
    const sum = await summaryOf(s.storefrontId);
    expect(sum.reviewCount).toBe(20);
    expect(sum.ratingSum).toBe(60);
    expect(Number(sum.version)).toBe(20);
    const r = await h.recompute.execute(new RecomputeRatingSummariesCommand({ trigger: 'manual' }));
    expect(r.repaired).toBe(0);
  });

  it('the recompute finds a drifted row, logs it, repairs it, and tells customer-api', async () => {
    const s = h.storefronts.add();
    await h.review(s, 5);
    await h.review(s, 3);
    // Drift it by hand, the way only an out-of-band write could.
    await prisma.ratingSummary.update({
      where: { subjectType_subjectId: { subjectType: 'STOREFRONT', subjectId: s.storefrontId } },
      data: { reviewCount: 3, ratingSum: 9, star1: 1, countEn: 3 },
    });
    const before = await prisma.outboxEvent.count({ where: { eventType: 'rating.summary.changed.v1' } });

    const r = await h.recompute.execute(new RecomputeRatingSummariesCommand({ trigger: 'manual' }));
    expect(r).toMatchObject({ checked: 1, repaired: 1 });
    expect(r.differences[0]).toMatchObject({
      storefrontId: s.storefrontId,
      stored: 'count=3 sum=9 stars=1/0/1/0/1 en=3 ar=0',
      actual: 'count=2 sum=8 stars=0/0/1/0/1 en=2 ar=0',
    });
    expect(await summaryOf(s.storefrontId)).toMatchObject({ reviewCount: 2, ratingSum: 8, star1: 0 });
    const events = await prisma.outboxEvent.findMany({
      where: { eventType: 'rating.summary.changed.v1' },
      orderBy: { createdAt: 'desc' },
    });
    expect(events.length).toBe(before + 1);
    expect(events[0].payload).toMatchObject({ cause: 'recompute', reviewCount: 2, average: 4 });

    // And a second run finds nothing.
    expect((await h.recompute.execute(new RecomputeRatingSummariesCommand({ trigger: 'manual' }))).repaired).toBe(0);
  });

  it('a storefront with a summary but no visible reviews recomputes to zero, average null', async () => {
    const s = h.storefronts.add();
    await h.review(s, 2);
    await prisma.review.updateMany({ data: { state: 'HIDDEN' } });
    await h.recompute.execute(new RecomputeRatingSummariesCommand({ trigger: 'manual' }));
    const row = await summaryOf(s.storefrontId);
    expect(row.reviewCount).toBe(0);
    const e = await prisma.outboxEvent.findFirstOrThrow({
      where: { eventType: 'rating.summary.changed.v1' },
      orderBy: { createdAt: 'desc' },
    });
    expect((e.payload as any).average).toBeNull();
  });
});
