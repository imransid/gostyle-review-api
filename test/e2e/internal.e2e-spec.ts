import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bootApp, KEYS, reset, type E2E } from './app';
import { rating, review, storefront } from './seed';

let e: E2E;
beforeAll(async () => {
  e = await bootApp();
});
afterAll(() => e.close());
beforeEach(() => reset(e.prisma));

describe('per-caller service keys', () => {
  it('401 with no key or an unknown one; 403 when a known caller is not allowed on the route', async () => {
    expect((await e.http().get('/internal/ratings')).status).toBe(401);
    const wrong = await e.http().get('/internal/ratings').set('x-service-key', 'guess');
    expect([wrong.status, wrong.body.error.code]).toEqual([401, 'SERVICE_KEY_INVALID']);
    const platform = await e.http().get('/internal/ratings').set('x-service-key', KEYS.platform);
    expect([platform.status, platform.body.error.code]).toEqual([403, 'SERVICE_CALLER_FORBIDDEN']);
    const customer = await e.http().post('/internal/ratings/recompute').set('x-service-key', KEYS.customerApi);
    expect(customer.status).toBe(403);
  });
});

describe('GET /internal/ratings', () => {
  it('by ids, and paged with a cursor, in the event shape', async () => {
    const a = storefront(e);
    const b = storefront(e);
    await review(e, a, { rating: 5, language: 'EN' });
    await review(e, b, { rating: 2, language: 'AR' });
    await review(e, b, { rating: 3, language: 'AR' });

    const byIds = await e.http().get(`/internal/ratings?storefrontIds=${a.storefrontId},${b.storefrontId}`).set('x-service-key', KEYS.customerApi);
    expect(byIds.status).toBe(200);
    const bRow = byIds.body.data.find((r: any) => r.storefrontId === b.storefrontId);
    expect(bRow).toMatchObject({
      tenantId: b.tenantId,
      branchId: b.branchId,
      reviewCount: 2,
      ratingSum: 5,
      average: 2.5,
      histogram: { '1': 0, '2': 1, '3': 1, '4': 0, '5': 0 },
      countByLanguage: { EN: 0, AR: 2 },
      version: '2',
    });

    const first = await e.http().get('/internal/ratings?limit=1').set('x-service-key', KEYS.ops);
    expect(first.body.data).toHaveLength(1);
    expect(first.body.nextCursor).toBe(first.body.data[0].storefrontId);
    const second = await e.http().get(`/internal/ratings?limit=1&after=${first.body.nextCursor}`).set('x-service-key', KEYS.ops);
    expect(second.body.data).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();

    const bad = await e.http().get('/internal/ratings?storefrontIds=nope').set('x-service-key', KEYS.ops);
    expect(bad.status).toBe(422);
  });
});

describe('POST /internal/ratings/recompute and GET /internal/outbox', () => {
  it('recomputes, reports drift, repairs it', async () => {
    const s = storefront(e);
    await review(e, s, { rating: 4, language: 'EN' });
    const clean = await e.http().post('/internal/ratings/recompute').set('x-service-key', KEYS.ops);
    expect(clean.body).toEqual({ checked: 1, repaired: 0, differences: [] });
    await e.prisma.ratingSummary.updateMany({ data: { reviewCount: 2, ratingSum: 8, star4: 2, countEn: 2 } });
    const fixed = await e.http().post('/internal/ratings/recompute').set('x-service-key', KEYS.ops);
    expect(fixed.body).toMatchObject({ checked: 1, repaired: 1 });
    expect((await rating(e, s)).count).toBe(1);
  });

  it('outbox stats for ops', async () => {
    const res = await e.http().get('/internal/outbox').set('x-service-key', KEYS.ops);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['oldestPendingSeconds', 'pending', 'stuck']);
    expect(typeof res.body.pending).toBe('number');
    expect(typeof res.body.stuck).toBe('number');
    expect(res.body.oldestPendingSeconds === null || typeof res.body.oldestPendingSeconds === 'number').toBe(true);
  });
});
