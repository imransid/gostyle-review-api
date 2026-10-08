import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from '../../src/review/domain/shared/uuidv7';
import { bootApp, reset, type E2E } from './app';
import { ALL_STAFF, hq, NOTE, rating, review, staff, storefront } from './seed';

let e: E2E;
beforeAll(async () => {
  e = await bootApp();
});
afterAll(() => e.close());
beforeEach(() => reset(e.prisma));

async function reported(rating = 1) {
  const s = storefront(e, { salonName: 'Jumeirah Studio', slug: 'jumeirah-studio' });
  const id = await review(e, s, { rating, language: 'EN', comment: 'Rude and late' });
  const who = staff(e, s, ALL_STAFF);
  const r = await e.http().post(`/v1/storefront/reviews/${id}/report`).set('authorization', who.auth).send({ reason: 'HARASSMENT', note: 'Names our stylist' });
  return { s, reviewId: id, reportId: r.body.reportId as string };
}

describe('two gates on every HQ route', () => {
  it('403 PLATFORM_ACCESS_REQUIRED for a salon token, even one holding the permission', async () => {
    const { s } = await reported();
    const salon = staff(e, s, ['storefront.review_moderation']);
    const res = await e.http().get('/v1/platform/review-reports').set('authorization', salon.auth);
    expect([res.status, res.body.error.code]).toEqual([403, 'PLATFORM_ACCESS_REQUIRED']);
  });

  it('403 PERMISSION_DENIED for HQ without storefront.review_moderation', async () => {
    const res = await e.http().get('/v1/platform/review-reports').set('authorization', hq(e, ['storefront.badge_review']).auth);
    expect([res.status, res.body.error.code]).toEqual([403, 'PERMISSION_DENIED']);
  });
});

describe('the report queue', () => {
  it('OPEN by default, oldest first, each row carrying the review and the salon', async () => {
    const first = await reported();
    const second = await reported();
    const res = await e.http().get('/v1/platform/review-reports').set('authorization', hq(e).auth);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 2, offset: 0, limit: 20 });
    expect(res.body.data.map((r: any) => r.id)).toEqual([first.reportId, second.reportId]);
    expect(res.body.data[0]).toMatchObject({
      tenantId: first.s.tenantId,
      salonName: 'Jumeirah Studio',
      storefrontSlug: 'jumeirah-studio',
      reason: 'HARASSMENT',
      status: 'OPEN',
      review: { id: first.reviewId, comment: 'Rude and late', state: 'PUBLISHED', authorDisplayName: 'Verified customer' },
    });
    const one = await e.http().get(`/v1/platform/review-reports/${first.reportId}`).set('authorization', hq(e).auth);
    expect(one.body.id).toBe(first.reportId);
    const none = await e.http().get(`/v1/platform/review-reports/${uuidv7()}`).set('authorization', hq(e).auth);
    expect([none.status, none.body.error.code]).toEqual([404, 'REPORT_NOT_FOUND']);
  });
});

describe('deciding', () => {
  it('uphold: 200, report UPHELD, review HIDDEN, out of the public page and rating', async () => {
    const { s, reviewId, reportId } = await reported(1);
    const me = hq(e);
    const res = await e.http().post(`/v1/platform/review-reports/${reportId}/uphold`).set('authorization', me.auth).send({ note: NOTE });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: reportId, status: 'UPHELD', reviewState: 'HIDDEN', resolvedById: me.sub, resolutionNote: NOTE });
    const pub = await e.http().get(`/v1/public/storefronts/${s.storefrontId}/reviews`);
    expect(pub.body.total).toBe(0);
    expect((await rating(e, s)).average).toBeNull();
    const twice = await e.http().post(`/v1/platform/review-reports/${reportId}/dismiss`).set('authorization', me.auth).send({ note: NOTE });
    expect([twice.status, twice.body.error.code]).toEqual([409, 'REPORT_TRANSITION_INVALID']);
    expect(reviewId).toBeTruthy();
  });

  it('dismiss: 200, the review untouched; a short reason is 422', async () => {
    const { s, reportId } = await reported(2);
    const short = await e.http().post(`/v1/platform/review-reports/${reportId}/dismiss`).set('authorization', hq(e).auth).send({ note: 'no' });
    expect([short.status, short.body.error.code]).toEqual([422, 'VALIDATION_FAILED']);
    const res = await e.http().post(`/v1/platform/review-reports/${reportId}/dismiss`).set('authorization', hq(e).auth).send({ note: NOTE });
    expect(res.body).toMatchObject({ status: 'DISMISSED', reviewState: 'PUBLISHED' });
    expect((await rating(e, s)).count).toBe(1);
  });

  it('hide, restore, remove; REMOVED is final', async () => {
    const s = storefront(e);
    const id = await review(e, s, { rating: 3, language: 'AR' });
    const me = hq(e);
    const post = (action: string, note = NOTE) =>
      e.http().post(`/v1/platform/reviews/${id}/${action}`).set('authorization', me.auth).send({ note });
    const hidden = await post('hide');
    expect(hidden.body).toMatchObject({ reviewId: id, state: 'HIDDEN', moderatedById: me.sub, moderationNote: NOTE });
    expect((await rating(e, s)).count).toBe(0);
    expect((await post('restore')).body.state).toBe('PUBLISHED');
    expect((await rating(e, s)).count).toBe(1);
    expect((await post('remove')).body.state).toBe('REMOVED');
    for (const action of ['restore', 'hide', 'remove']) {
      const r = await post(action);
      expect([r.status, r.body.error.code]).toEqual([409, 'REVIEW_TRANSITION_INVALID']);
    }
    const missing = await e.http().post(`/v1/platform/reviews/${uuidv7()}/hide`).set('authorization', me.auth).send({ note: NOTE });
    expect([missing.status, missing.body.error.code]).toEqual([404, 'REVIEW_NOT_FOUND']);
  });
});
