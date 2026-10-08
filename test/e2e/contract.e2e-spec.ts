import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp, type E2E } from './app';

let e: E2E;
beforeAll(async () => {
  e = await bootApp();
});
afterAll(() => e.close());

/** Plan §5's endpoints, at the paths the front ends already call. */
const EXPECTED = [
  'GET /health',
  'POST /v1/public/reviews/{token}',
  'GET /v1/public/review-invites/{token}',
  'GET /v1/public/storefronts/{storefrontId}/reviews',
  'GET /v1/public/storefronts/{storefrontId}/rating',
  'GET /v1/storefront/reviews',
  'GET /v1/storefront/reviews/aggregate',
  'POST /v1/storefront/reviews/{reviewId}/reply',
  'PATCH /v1/storefront/reviews/{reviewId}/reply',
  'DELETE /v1/storefront/reviews/{reviewId}/reply',
  'POST /v1/storefront/reviews/{reviewId}/report',
  'GET /v1/platform/review-reports',
  'GET /v1/platform/review-reports/{id}',
  'POST /v1/platform/review-reports/{id}/uphold',
  'POST /v1/platform/review-reports/{id}/dismiss',
  'POST /v1/platform/reviews/{id}/hide',
  'POST /v1/platform/reviews/{id}/restore',
  'POST /v1/platform/reviews/{id}/remove',
  'GET /internal/ratings',
  'POST /internal/ratings/recompute',
];

describe('the published contract', () => {
  it('serves every endpoint of plan §5 at its documented path', async () => {
    const doc = (await e.http().get('/docs-json')).body;
    const served = Object.entries(doc.paths as Record<string, Record<string, unknown>>).flatMap(([p, ops]) =>
      Object.keys(ops).map((m) => `${m.toUpperCase()} ${p}`),
    );
    for (const route of EXPECTED) expect(served, route).toContain(route);
  });

  it('documents the security of every non-public route', async () => {
    const doc = (await e.http().get('/docs-json')).body;
    for (const [p, ops] of Object.entries(doc.paths as Record<string, Record<string, any>>)) {
      for (const op of Object.values(ops)) {
        if (p.startsWith('/v1/storefront') || p.startsWith('/v1/platform')) {
          expect(op.security, p).toEqual([{ 'platform-jwt': [] }]);
        }
        if (p.startsWith('/internal')) expect(op.security, p).toEqual([{ 'service-key': [] }]);
      }
    }
  });

  it('answers /health green with the database and Redis up', async () => {
    const res = await e.http().get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', checks: { database: { status: 'up' }, redis: { status: 'up' } } });
  });
});
