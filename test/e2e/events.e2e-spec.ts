import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from '../../src/review/domain/shared/uuidv7';
import { bootApp, KEYS, reset, type E2E } from './app';
import { ALL_STAFF, freshIp, invite, staff, storefront } from './seed';

let e: E2E;
beforeAll(async () => {
  e = await bootApp();
});
afterAll(() => e.close());
beforeEach(async () => {
  await reset(e.prisma);
  e.push.requests.length = 0;
  e.customerApi.requests.length = 0;
});

/** Wait for the relay (every 200 ms here) to have done something. */
async function until(check: () => boolean | Promise<boolean>, ms = 8_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('timed out waiting');
}

const platformCompleted = (branchId: string, tenantId: string, customerId: string | null, bookingId = uuidv7()) => ({
  id: uuidv7(),
  type: 'bookings.booking.completed.v1',
  aggregateId: bookingId,
  tenantId,
  occurredAt: new Date().toISOString(),
  payload: { branchId, customerId, clientId: null, staffId: uuidv7(), serviceIds: [] },
});

describe('POST /internal/events', () => {
  it('platform: a completed booking mints ONE invite, delivered twice; the send is recorded', async () => {
    const s = storefront(e);
    const customerId = uuidv7();
    e.platform.contacts.set(customerId, { displayName: 'Sara', phone: '+971501234567' });
    const event = platformCompleted(s.branchId, s.tenantId, customerId);

    const first = await e.http().post('/internal/events').set('x-service-key', KEYS.platform).send(event);
    const second = await e.http().post('/internal/events').set('x-service-key', KEYS.platform).send(event);
    expect(first.body).toEqual({ outcome: 'invite_minted', sendStatus: 'SENT' });
    expect(second.body).toEqual({ outcome: 'duplicate_event' });

    const invites = await e.prisma.reviewInvite.findMany();
    expect(invites).toHaveLength(1);
    expect(invites[0]).toMatchObject({ bookingSource: 'platform', bookingId: event.aggregateId, sendStatus: 'SENT' });
    expect(await e.prisma.inboxEvent.findMany()).toEqual([
      expect.objectContaining({ source: 'platform', eventId: event.id, outcome: 'invite_minted' }),
    ]);
  });

  it('booking-api: same, with booking_api as the source and NO_CONTACT (owner undecided)', async () => {
    const s = storefront(e);
    const event = {
      id: uuidv7(),
      type: 'booking.completed',
      aggregateId: uuidv7(),
      payload: { branchId: s.branchId, customerId: uuidv7(), tenantId: s.tenantId },
    };
    const first = await e.http().post('/internal/events').set('x-service-key', KEYS.bookingApi).send(event);
    const second = await e.http().post('/internal/events').set('x-service-key', KEYS.bookingApi).send(event);
    expect(first.body).toEqual({ outcome: 'invite_minted', sendStatus: 'NO_CONTACT' });
    expect(second.body.outcome).toBe('duplicate_event');
    const invites = await e.prisma.reviewInvite.findMany();
    expect(invites).toHaveLength(1);
    expect(invites[0].bookingSource).toBe('booking_api');
  });

  it('a second, different event for the same booking does not mint again', async () => {
    const s = storefront(e);
    const bookingId = uuidv7();
    await e.http().post('/internal/events').set('x-service-key', KEYS.platform).send(platformCompleted(s.branchId, s.tenantId, null, bookingId));
    const again = await e.http().post('/internal/events').set('x-service-key', KEYS.platform).send(platformCompleted(s.branchId, s.tenantId, null, bookingId));
    expect(again.body).toEqual({ outcome: 'already_invited' });
    expect(await e.prisma.reviewInvite.count()).toBe(1);
  });

  it('an event type from the wrong caller is ignored; an unknown key is 401; customer-api may not post events', async () => {
    const s = storefront(e);
    const event = platformCompleted(s.branchId, s.tenantId, null);
    expect((await e.http().post('/internal/events').set('x-service-key', KEYS.bookingApi).send(event)).body).toEqual({ outcome: 'ignored' });
    expect((await e.http().post('/internal/events').set('x-service-key', 'nope').send(event)).status).toBe(401);
    expect((await e.http().post('/internal/events').set('x-service-key', KEYS.customerApi).send(event)).status).toBe(403);
    expect(await e.prisma.reviewInvite.count()).toBe(0);
  });

  it('503 when the platform cannot say which storefront: nothing is recorded, so the retry works', async () => {
    const s = storefront(e);
    const event = platformCompleted(s.branchId, s.tenantId, null);
    e.platform.down = true;
    const down = await e.http().post('/internal/events').set('x-service-key', KEYS.platform).send(event);
    e.platform.down = false;
    expect([down.status, down.body.error.code]).toEqual([503, 'DEPENDENCY_UNAVAILABLE']);
    expect(await e.prisma.inboxEvent.count()).toBe(0);
    const retried = await e.http().post('/internal/events').set('x-service-key', KEYS.platform).send(event);
    expect(retried.body.outcome).toBe('invite_minted');
  });
});

describe('what the relay carries out', () => {
  it('rating.summary.changed.v1 reaches customer-api with review-service\'s key', async () => {
    const s = storefront(e);
    const { token } = await invite(e, s);
    const res = await e.http().post(`/v1/public/reviews/${token}`).set('x-forwarded-for', freshIp()).send({ rating: 4, language: 'EN' });
    expect(res.status).toBe(201);

    await until(() => e.customerApi.requests.some((r) => r.body?.type === 'rating.summary.changed.v1'));
    const req = e.customerApi.requests.find((r) => r.body?.type === 'rating.summary.changed.v1')!;
    expect(req.url).toBe('/internal/review-events/');
    expect(req.headers['x-service-key']).toBe(KEYS.reviewCallsCustomer);
    expect(req.body.payload).toMatchObject({ storefrontId: s.storefrontId, reviewCount: 1, ratingSum: 4, average: 4, version: '1' });
  });

  it('a salon reply on a booking-api review pushes once, with eventId review:<id>:reply', async () => {
    const s = storefront(e);
    const { token } = await invite(e, s, { bookingSource: 'booking_api' });
    const reviewId = (await e.http().post(`/v1/public/reviews/${token}`).set('x-forwarded-for', freshIp()).send({ rating: 5, language: 'EN' })).body.reviewId;
    const who = staff(e, s, ALL_STAFF);
    await e.http().post(`/v1/storefront/reviews/${reviewId}/reply`).set('authorization', who.auth).send({ body: 'Thank you!' });

    await until(() => e.push.requests.length > 0);
    expect(e.push.requests).toHaveLength(1);
    expect(e.push.requests[0].url).toBe('/notifications/user');
    expect(e.push.requests[0].body).toMatchObject({ eventId: `review:${reviewId}:reply`, title: 'The salon replied' });
  });

  it('a reply on a platform review is a logged skip: no push, and the event is still published', async () => {
    const s = storefront(e);
    const { token } = await invite(e, s, { bookingSource: 'platform' });
    const reviewId = (await e.http().post(`/v1/public/reviews/${token}`).set('x-forwarded-for', freshIp()).send({ rating: 5, language: 'EN' })).body.reviewId;
    const who = staff(e, s, ALL_STAFF);
    await e.http().post(`/v1/storefront/reviews/${reviewId}/reply`).set('authorization', who.auth).send({ body: 'Thanks' });
    await until(async () => (await e.prisma.outboxEvent.count({ where: { eventType: 'review.reply.posted.v1', publishedAt: { not: null } } })) === 1);
    expect(e.push.requests).toHaveLength(0);
  });
});
