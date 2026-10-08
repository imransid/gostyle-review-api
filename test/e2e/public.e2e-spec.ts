import { Reflector } from '@nestjs/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from '../../src/review/domain/shared/uuidv7';
import { PublicReviewsController } from '../../src/review/presentation/public-reviews.controller';
import { bootApp, reset, type E2E } from './app';
import { ALL_STAFF, freshIp, invite, review, staff, storefront } from './seed';

let e: E2E;
beforeAll(async () => {
  e = await bootApp();
});
afterAll(() => e.close());
beforeEach(() => reset(e.prisma));

const submit = (token: string, body: Record<string, unknown>, ip = freshIp()) =>
  e.http().post(`/v1/public/reviews/${token}`).set('x-forwarded-for', ip).send(body);

describe('POST /v1/public/reviews/:token', () => {
  it('201 { reviewId }, with no login', async () => {
    const s = storefront(e);
    const { token } = await invite(e, s);
    const res = await submit(token, { rating: 5, language: 'EN', comment: 'Lovely' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ reviewId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  });

  it('maps every refusal in the platform envelope: 404, 410, 409, 422', async () => {
    const s = storefront(e);
    const notFound = await submit('not-a-real-token', { rating: 5, language: 'EN' });
    expect(notFound.status).toBe(404);
    expect(notFound.body).toEqual({ error: { code: 'INVITE_NOT_FOUND', message: expect.any(String), details: [] } });

    const expired = await invite(e, s);
    await e.prisma.reviewInvite.update({
      where: { id: expired.inviteId },
      data: { createdAt: new Date(Date.now() - 40 * 86_400_000), expiresAt: new Date(Date.now() - 1000) },
    });
    const gone = await submit(expired.token, { rating: 5, language: 'EN' });
    expect([gone.status, gone.body.error.code]).toEqual([410, 'INVITE_EXPIRED']);

    const used = await invite(e, s);
    expect((await submit(used.token, { rating: 5, language: 'EN' })).status).toBe(201);
    const again = await submit(used.token, { rating: 1, language: 'EN' });
    expect([again.status, again.body.error.code]).toEqual([409, 'INVITE_ALREADY_USED']);

    const bad = await submit((await invite(e, s)).token, { rating: 6, language: 'EN' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    expect(bad.body.error.details).toContainEqual(expect.objectContaining({ field: 'rating', code: 'OUT_OF_RANGE' }));
  });

  it('refuses unknown fields, a fractional rating and a third language', async () => {
    const s = storefront(e);
    const { token } = await invite(e, s);
    for (const body of [
      { rating: 4.5, language: 'EN' },
      { rating: 5, language: 'FR' },
      { rating: 5, language: 'EN', tenantId: uuidv7() },
    ]) {
      const res = await submit(token, body);
      expect([res.status, res.body.error.code]).toEqual([422, 'VALIDATION_FAILED']);
    }
    // None of those spent the invite.
    expect((await submit(token, { rating: 5, language: 'EN' })).status).toBe(201);
  });

  it('THROTTLED: the 11th submit in an hour from one IP is 429; another IP is unaffected', async () => {
    const ip = '198.51.100.77';
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await submit(`junk-${i}`, { rating: 5, language: 'EN' }, ip)).status);
    expect(statuses.slice(0, 10).every((s) => s === 404)).toBe(true);
    expect(statuses[10]).toBe(429);
    const limited = await submit('junk', { rating: 5, language: 'EN' }, ip);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect((await submit('junk', { rating: 5, language: 'EN' }, '198.51.100.78')).status).toBe(404);
  });

  it('declares both limits on the route: 10 per hour and 40 per day', () => {
    const r = new Reflector();
    const handler = PublicReviewsController.prototype.submit;
    const meta = Reflect.getMetadataKeys(handler)
      .filter((k) => String(k).startsWith('THROTTLER:'))
      .reduce((acc: Record<string, unknown>, k) => ({ ...acc, [String(k)]: r.get(k, handler) }), {});
    expect(meta).toMatchObject({
      'THROTTLER:LIMITpublic-review-ip-hour': 10,
      'THROTTLER:TTLpublic-review-ip-hour': 3_600_000,
      'THROTTLER:LIMITpublic-review-ip-day': 40,
      'THROTTLER:TTLpublic-review-ip-day': 86_400_000,
    });
  });
});

describe('GET /v1/public/review-invites/:token', () => {
  it('says OPEN, then USED, and names the salon; 404 for an unknown token', async () => {
    const s = storefront(e, { salonName: 'Al Wasl Barbers' });
    const { token } = await invite(e, s);
    const open = await e.http().get(`/v1/public/review-invites/${token}`);
    expect(open.status).toBe(200);
    expect(open.body).toMatchObject({ status: 'OPEN', salonName: 'Al Wasl Barbers', storefrontId: s.storefrontId });
    await submit(token, { rating: 4, language: 'AR' });
    expect((await e.http().get(`/v1/public/review-invites/${token}`)).body.status).toBe('USED');
    const missing = await e.http().get('/v1/public/review-invites/nope');
    expect([missing.status, missing.body.error.code]).toEqual([404, 'INVITE_NOT_FOUND']);
  });
});

describe('GET /v1/public/storefronts/:id/reviews and /rating', () => {
  it('shows PUBLISHED reviews only, newest first, blank names as "Verified customer", replies without author', async () => {
    const s = storefront(e);
    const hiddenId = await review(e, s, { rating: 1, language: 'EN', comment: 'hidden one' });
    await e.prisma.review.update({ where: { id: hiddenId }, data: { state: 'HIDDEN' } });
    const firstId = await review(e, s, { rating: 4, language: 'EN' });
    const secondId = await review(e, s, { rating: 5, language: 'AR', comment: 'ممتاز' });
    // A reply from the salon on the first.
    const who = staff(e, s, ALL_STAFF);
    await e.http().post(`/v1/storefront/reviews/${firstId}/reply`).set('authorization', who.auth).send({ body: 'Thank you!' });

    const res = await e.http().get(`/v1/public/storefronts/${s.storefrontId}/reviews`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.data.map((r: any) => r.id)).toEqual([secondId, firstId]);
    expect(res.body.data[1]).toMatchObject({ authorDisplayName: 'Verified customer', reply: { body: 'Thank you!' } });
    expect(res.body.data[1].reply).not.toHaveProperty('authorId');
    expect(JSON.stringify(res.body)).not.toContain('hidden one');

    const ar = await e.http().get(`/v1/public/storefronts/${s.storefrontId}/reviews?language=AR`);
    expect(ar.body.data.map((r: any) => r.id)).toEqual([secondId]);
  });

  it('the rating: one decimal, per language, every histogram key; null average with no reviews', async () => {
    const s = storefront(e);
    const empty = await e.http().get(`/v1/public/storefronts/${s.storefrontId}/rating`);
    expect(empty.body).toEqual({
      average: null,
      count: 0,
      countByLanguage: { EN: 0, AR: 0 },
      histogram: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
    });
    await review(e, s, { rating: 5, language: 'EN' });
    await review(e, s, { rating: 4, language: 'AR' });
    await review(e, s, { rating: 4, language: 'EN' });
    const r = await e.http().get(`/v1/public/storefronts/${s.storefrontId}/rating`);
    expect(r.body).toEqual({
      average: 4.3,
      count: 3,
      countByLanguage: { EN: 2, AR: 1 },
      histogram: { '1': 0, '2': 0, '3': 0, '4': 2, '5': 1 },
    });
  });

  it('refuses a storefront id that is not a uuid', async () => {
    const res = await e.http().get('/v1/public/storefronts/not-a-uuid/rating');
    expect(res.status).toBe(400);
  });
});
