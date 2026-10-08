import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeAggregate, type RatedReview } from '../../src/review/domain/services/review-rules';
import { bootApp, KEYS, reset, type E2E } from './app';
import { ALL_STAFF, hq, NOTE, rating, review, staff, storefront } from './seed';

let e: E2E;
beforeAll(async () => {
  e = await bootApp();
  await reset(e.prisma);
});
afterAll(() => e.close());

// Deterministic, so a failure reproduces.
let x = 20261008;
const rand = (n: number) => {
  x = (x * 1103515245 + 12345) % 2 ** 31;
  return x % n;
};

describe('P4 done-when: stored summaries equal a full recompute on seeded data', () => {
  it('after 90 reviews across 6 storefronts and a mix of hides, restores, removals and upheld reports', async () => {
    const shops = Array.from({ length: 6 }, () => storefront(e));
    const ids: { id: string; shop: number }[] = [];
    for (let i = 0; i < 90; i++) {
      const shop = rand(6);
      const id = await review(e, shops[shop], { rating: 1 + rand(5), language: rand(2) ? 'EN' : 'AR' });
      ids.push({ id, shop });
    }
    const me = hq(e);
    for (const { id, shop } of ids) {
      const roll = rand(10);
      if (roll === 0) await e.http().post(`/v1/platform/reviews/${id}/hide`).set('authorization', me.auth).send({ note: NOTE });
      if (roll === 1) {
        await e.http().post(`/v1/platform/reviews/${id}/hide`).set('authorization', me.auth).send({ note: NOTE });
        await e.http().post(`/v1/platform/reviews/${id}/restore`).set('authorization', me.auth).send({ note: NOTE });
      }
      if (roll === 2) await e.http().post(`/v1/platform/reviews/${id}/remove`).set('authorization', me.auth).send({ note: NOTE });
      if (roll === 3) {
        const who = staff(e, shops[shop], ALL_STAFF);
        const r = await e.http().post(`/v1/storefront/reviews/${id}/report`).set('authorization', who.auth).send({ reason: 'OFF_TOPIC_OR_SPAM' });
        await e.http().post(`/v1/platform/review-reports/${r.body.reportId}/uphold`).set('authorization', me.auth).send({ note: NOTE });
      }
      if (roll === 4) {
        const who = staff(e, shops[shop], ALL_STAFF);
        await e.http().post(`/v1/storefront/reviews/${id}/reply`).set('authorization', who.auth).send({ body: 'Thanks' });
      }
    }

    // An INDEPENDENT recompute, straight from the rows, not through any
    // service code: PUBLISHED reviews per storefront, then the ported
    // computeAggregate on them.
    for (const s of shops) {
      const rows = await e.prisma.$queryRaw<RatedReview[]>`
        SELECT rating::int AS rating, language::text AS language
          FROM review WHERE storefront_id = ${s.storefrontId}::uuid AND state = 'PUBLISHED'`;
      const expected = computeAggregate(rows);
      const served = await rating(e, s);
      expect(served, s.storefrontId).toEqual(expected);
      const stored = await e.prisma.ratingSummary.findUnique({
        where: { subjectType_subjectId: { subjectType: 'STOREFRONT', subjectId: s.storefrontId } },
      });
      if (stored) {
        expect(stored.reviewCount).toBe(rows.length);
        expect(stored.ratingSum).toBe(rows.reduce((n, r) => n + r.rating, 0));
      } else {
        expect(rows).toHaveLength(0);
      }
    }

    // And the service's own nightly recompute finds nothing to repair.
    // Every storefront that received a review is checked (a storefront nobody
    // reviewed has no row and nothing to compare).
    const reviewed = new Set(ids.map((i) => i.shop)).size;
    const r = await e.http().post('/internal/ratings/recompute').set('x-service-key', KEYS.ops);
    expect(r.body).toMatchObject({ checked: reviewed, repaired: 0, differences: [] });
  });
});
