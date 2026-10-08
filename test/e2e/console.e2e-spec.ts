import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from '../../src/review/domain/shared/uuidv7';
import { platformToken } from '../support/tokens';
import { bootApp, JWT_SECRET, reset, type E2E } from './app';
import { ALL_STAFF, review, staff, storefront } from './seed';

let e: E2E;
beforeAll(async () => {
  e = await bootApp();
});
afterAll(() => e.close());
beforeEach(() => {
  e.platform.down = false;
  return reset(e.prisma);
});

describe('who may call the console', () => {
  it('401 without a token, with an expired one, or one gostyle-api did not issue', async () => {
    const s = storefront(e);
    expect((await e.http().get('/v1/storefront/reviews')).status).toBe(401);
    const expired = platformToken(JWT_SECRET, { sub: uuidv7(), tenantId: s.tenantId }, { expiresIn: -10 });
    expect((await e.http().get('/v1/storefront/reviews').set('authorization', `Bearer ${expired}`)).status).toBe(401);
    const foreign = platformToken(JWT_SECRET, { sub: uuidv7(), tenantId: s.tenantId }, { issuer: 'someone-else' });
    expect((await e.http().get('/v1/storefront/reviews').set('authorization', `Bearer ${foreign}`)).status).toBe(401);
    const wrongKey = platformToken('another-secret', { sub: uuidv7(), tenantId: s.tenantId });
    expect((await e.http().get('/v1/storefront/reviews').set('authorization', `Bearer ${wrongKey}`)).status).toBe(401);
  });

  it('403 PERMISSION_DENIED without the code the platform route required', async () => {
    const s = storefront(e);
    const reader = staff(e, s, ['storefront-edit.read']);
    const id = await review(e, s);
    const res = await e.http().post(`/v1/storefront/reviews/${id}/reply`).set('authorization', reader.auth).send({ body: 'x' });
    expect([res.status, res.body.error.code]).toEqual([403, 'PERMISSION_DENIED']);
    const rep = await e.http().post(`/v1/storefront/reviews/${id}/report`).set('authorization', reader.auth).send({ reason: 'HARASSMENT' });
    expect([rep.status, rep.body.error.code]).toEqual([403, 'PERMISSION_DENIED']);
  });

  it('NEVER A DEFAULT TENANT: a token with no tenant is 403 TENANT_REQUIRED', async () => {
    const s = storefront(e);
    const noTenant = staff(e, s, ALL_STAFF, { tenantId: undefined });
    const res = await e.http().get('/v1/storefront/reviews').set('authorization', noTenant.auth);
    expect([res.status, res.body.error.code]).toEqual([403, 'TENANT_REQUIRED']);
  });

  it('422 BRANCH_REQUIRED with no branch on the token and none in the request', async () => {
    const s = storefront(e);
    const noBranch = staff(e, s, ALL_STAFF, { branchId: null });
    const res = await e.http().get('/v1/storefront/reviews').set('authorization', noBranch.auth);
    expect([res.status, res.body.error.code]).toEqual([422, 'BRANCH_REQUIRED']);
    const ok = await e.http().get(`/v1/storefront/reviews?branchId=${s.branchId}`).set('authorization', noBranch.auth);
    expect(ok.status).toBe(200);
  });

  it('503 DEPENDENCY_UNAVAILABLE, never a pass, when the platform cannot say what the caller may do', async () => {
    const s = storefront(e);
    const who = staff(e, s, ALL_STAFF);
    e.platform.down = true;
    const res = await e.http().get('/v1/storefront/reviews').set('authorization', who.auth);
    expect([res.status, res.body.error.code]).toEqual([503, 'DEPENDENCY_UNAVAILABLE']);
  });
});

describe('GET /v1/storefront/reviews and /aggregate', () => {
  it("every state, newest first, with replies, reports and the PUBLIC summary; only this salon's", async () => {
    const s = storefront(e);
    const other = storefront(e);
    await review(e, other, { rating: 1, language: 'EN' });
    const a = await review(e, s, { rating: 5, language: 'EN' });
    const b = await review(e, s, { rating: 2, language: 'AR' });
    await e.prisma.review.update({ where: { id: b }, data: { state: 'HIDDEN' } });
    await e.prisma.ratingSummary.updateMany({
      where: { subjectId: s.storefrontId },
      data: { reviewCount: 1, ratingSum: 5, star2: 0, countAr: 0 },
    });
    const who = staff(e, s, ALL_STAFF);
    await e.http().post(`/v1/storefront/reviews/${a}/report`).set('authorization', who.auth).send({ reason: 'HARASSMENT' });

    const res = await e.http().get('/v1/storefront/reviews').set('authorization', who.auth);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 2, offset: 0, limit: 20 });
    expect(res.body.data.map((r: any) => [r.id, r.state])).toEqual([
      [b, 'HIDDEN'],
      [a, 'PUBLISHED'],
    ]);
    expect(res.body.data[1].reports).toEqual([expect.objectContaining({ reason: 'HARASSMENT', status: 'OPEN' })]);
    expect(res.body.data[0]).toMatchObject({ reply: null, reports: [] });
    expect(res.body.summary).toMatchObject({ average: 5, count: 1 });

    // The state filter narrows; an over-large limit is capped at 50, as on the platform.
    const hidden = await e.http().get('/v1/storefront/reviews?state=HIDDEN&limit=500').set('authorization', who.auth);
    expect(hidden.status).toBe(200);
    expect(hidden.body).toMatchObject({ total: 1, limit: 50 });
    expect(hidden.body.data.map((r: any) => r.id)).toEqual([b]);
  });

  it('aggregate is the same summary the public sees', async () => {
    const s = storefront(e);
    await review(e, s, { rating: 4, language: 'EN' });
    await review(e, s, { rating: 3, language: 'AR' });
    const who = staff(e, s, ['storefront-edit.read']);
    const res = await e.http().get('/v1/storefront/reviews/aggregate').set('authorization', who.auth);
    const pub = await e.http().get(`/v1/public/storefronts/${s.storefrontId}/rating`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(pub.body);
    expect(res.body).toMatchObject({ average: 3.5, count: 2 });
  });
});

describe('replies and reports', () => {
  it('POST 201, second POST 409, PATCH 200, DELETE 204 then 404', async () => {
    const s = storefront(e);
    const id = await review(e, s);
    const who = staff(e, s, ALL_STAFF);
    const url = `/v1/storefront/reviews/${id}/reply`;
    const posted = await e.http().post(url).set('authorization', who.auth).send({ body: ' Thank you ' });
    expect(posted.status).toBe(201);
    expect(posted.body).toEqual({ reviewId: id, body: 'Thank you', createdAt: expect.any(String), editedAt: null });
    const again = await e.http().post(url).set('authorization', who.auth).send({ body: 'Again' });
    expect([again.status, again.body.error.code]).toEqual([409, 'REPLY_ALREADY_EXISTS']);
    const edited = await e.http().patch(url).set('authorization', who.auth).send({ body: 'Thank you so much' });
    expect([edited.status, edited.body.body]).toEqual([200, 'Thank you so much']);
    expect(edited.body.editedAt).not.toBeNull();
    expect((await e.http().delete(url).set('authorization', who.auth)).status).toBe(204);
    const gone = await e.http().delete(url).set('authorization', who.auth);
    expect([gone.status, gone.body.error.code]).toEqual([404, 'REPLY_NOT_FOUND']);
    const empty = await e.http().post(url).set('authorization', who.auth).send({ body: '   ' });
    expect([empty.status, empty.body.error.code]).toEqual([422, 'VALIDATION_FAILED']);
  });

  it("another salon's staff get 404 REVIEW_NOT_FOUND, even naming the branch explicitly", async () => {
    const s = storefront(e);
    const other = storefront(e);
    const id = await review(e, s);
    const stranger = staff(e, other, ALL_STAFF);
    const res = await e.http().post(`/v1/storefront/reviews/${id}/reply`).set('authorization', stranger.auth).send({ body: 'hi', branchId: s.branchId });
    expect([res.status, res.body.error.code]).toEqual([404, 'REVIEW_NOT_FOUND']);
    const rep = await e.http().post(`/v1/storefront/reviews/${id}/report`).set('authorization', stranger.auth).send({ reason: 'HARASSMENT', branchId: s.branchId });
    expect(rep.status).toBe(404);
  });

  it('report: 201 and the review stays PUBLISHED; a second open report is 409', async () => {
    const s = storefront(e);
    const id = await review(e, s);
    const who = staff(e, s, ALL_STAFF);
    const url = `/v1/storefront/reviews/${id}/report`;
    const filed = await e.http().post(url).set('authorization', who.auth).send({ reason: 'FAKE_NO_VISIT', note: 'No booking matches.' });
    expect(filed.status).toBe(201);
    expect(filed.body).toMatchObject({ reviewId: id, status: 'OPEN', reviewState: 'PUBLISHED' });
    const again = await e.http().post(url).set('authorization', who.auth).send({ reason: 'HARASSMENT' });
    expect([again.status, again.body.error.code]).toEqual([409, 'REPORT_ALREADY_OPEN']);
    const unfair = await e.http().post(url).set('authorization', who.auth).send({ reason: 'UNFAIR' });
    expect([unfair.status, unfair.body.error.code]).toEqual([422, 'VALIDATION_FAILED']);
  });
});
