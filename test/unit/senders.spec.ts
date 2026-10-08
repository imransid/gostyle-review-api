import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReplyPushHandler, replyPushEventId } from '../../src/review/application/event-handlers/reply-push.handler';
import { CustomerApiRatingSink } from '../../src/review/infrastructure/http/customer-api-rating.sink';
import { PushNotificationClient } from '../../src/review/infrastructure/http/push-notification.client';
import { BookingSourcePushRecipients } from '../../src/review/infrastructure/http/push-recipients';
import { LogInviteSender } from '../../src/review/infrastructure/senders/log-invite-sender';
import { maskPhone } from '../../src/review/infrastructure/senders/mask-phone';
import { WhatsAppInviteSender } from '../../src/review/infrastructure/senders/whatsapp-invite-sender';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const message = {
  phone: '+971501234567',
  locale: 'ar' as const,
  body: 'body with https://gostyle.app/review/TOKEN123',
  salonName: 'Marina Walk',
  displayName: 'سارة',
  url: 'https://gostyle.app/review/TOKEN123',
};

describe('maskPhone and LogInviteSender', () => {
  it('masks the number and never logs the body or the link', async () => {
    expect(maskPhone('+971501234567')).toBe('+97150*****67');
    const logs: string[] = [];
    vi.spyOn(Logger.prototype, 'log').mockImplementation((m: any) => void logs.push(String(m)));
    expect(await new LogInviteSender().send(message)).toEqual({ kind: 'sent', ref: 'log' });
    expect(logs.join()).not.toContain('TOKEN123');
    expect(logs.join()).not.toContain('+971501234567');
  });
});

describe('WhatsAppInviteSender', () => {
  const config = {
    reviewPublicBaseUrl: 'https://gostyle.app/review',
    whatsapp: { phoneNumberId: 'PNID', accessToken: 'AT', templateEn: 'review_en', templateAr: 'review_ar', apiVersion: 'v23.0' },
  } as any;

  it('sends the per-language template, with the token as the URL button suffix', async () => {
    const fetch = vi.fn(async (_u: string, _i?: RequestInit) => new Response(JSON.stringify({ messages: [{ id: 'wamid.X' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    expect(await new WhatsAppInviteSender(config).send(message)).toEqual({ kind: 'sent', ref: 'wamid.X' });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v23.0/PNID/messages');
    const body = JSON.parse(String(init!.body));
    expect(body).toMatchObject({ to: '971501234567', template: { name: 'review_ar', language: { code: 'ar' } } });
    expect(body.template.components[0].parameters.map((p: any) => p.text)).toEqual(['سارة', 'Marina Walk']);
    expect(body.template.components[1].parameters[0].text).toBe('TOKEN123');
  });

  it.each([
    [503, 'retry'],
    [429, 'retry'],
    [400, 'failed'],
    [401, 'failed'],
  ])('HTTP %i is %s', async (status, kind) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status })));
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    expect((await new WhatsAppInviteSender(config).send(message)).kind).toBe(kind);
  });

  it('a refused connection is a retry; a timeout is UNKNOWN (it may have landed)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(Object.assign(new TypeError('fetch failed'), { name: 'TypeError' }))));
    expect((await new WhatsAppInviteSender(config).send(message)).kind).toBe('retry');
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(Object.assign(new Error('t'), { name: 'TimeoutError' }))));
    expect((await new WhatsAppInviteSender(config).send(message)).kind).toBe('unknown');
  });
});

describe('the reply push', () => {
  const event = (id: string) => ({ id: 'e', tenantId: 't', aggregateType: 'review', aggregateId: id, eventType: 'review.reply.posted.v1', payload: {}, createdAt: new Date(), attempts: 0 });
  const prisma = (bookingSource: string) => ({
    review: { findUnique: vi.fn(async () => ({ bookingSource, customerId: 'cust-1', storefrontId: 'sf', invite: { salonName: 'Marina Walk' } })) },
  });

  it('pushes to the booking-api customer with eventId review:<id>:reply', async () => {
    const push = { send: vi.fn(async () => ({ kind: 'sent' as const })) };
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    await new ReplyPushHandler(prisma('booking_api') as any, new BookingSourcePushRecipients(), push).deliver(event('r1'));
    expect(push.send).toHaveBeenCalledWith(expect.objectContaining({ userId: 'cust-1', eventId: 'review:r1:reply', body: 'Marina Walk replied to your review.' }));
    expect(replyPushEventId('r1')).toBe('review:r1:reply');
  });

  it('SKIPS (logs, does not fail) when no push user can be resolved: a platform booking', async () => {
    const push = { send: vi.fn() };
    const logs: string[] = [];
    vi.spyOn(Logger.prototype, 'log').mockImplementation((m: any) => void logs.push(String(m)));
    await expect(new ReplyPushHandler(prisma('platform') as any, new BookingSourcePushRecipients(), push as any).deliver(event('r2'))).resolves.toBeUndefined();
    expect(push.send).not.toHaveBeenCalled();
    expect(logs.join()).toContain('skipped');
  });

  it('throws on a transient failure (the relay retries); swallows a permanent refusal', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const retry = { send: vi.fn(async () => ({ kind: 'retry' as const, error: 'HTTP 502' })) };
    await expect(new ReplyPushHandler(prisma('booking_api') as any, new BookingSourcePushRecipients(), retry).deliver(event('r3'))).rejects.toThrow('HTTP 502');
    const failed = { send: vi.fn(async () => ({ kind: 'failed' as const, error: 'HTTP 400' })) };
    await expect(new ReplyPushHandler(prisma('booking_api') as any, new BookingSourcePushRecipients(), failed).deliver(event('r4'))).resolves.toBeUndefined();
  });
});

describe('PushNotificationClient and CustomerApiRatingSink', () => {
  const config = { push: { url: 'http://push', key: 'pk' }, customerApi: { url: 'http://cust', key: 'ck' } } as any;

  it('push: 202 with devices is sent, with none is skipped, 5xx retry, 4xx failed', async () => {
    const c = new PushNotificationClient(config);
    const msg = { userId: 'u', eventId: 'review:x:reply', title: 't', body: 'b', data: {} };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ devices: 2 }), { status: 202 })));
    expect((await c.send(msg)).kind).toBe('sent');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ devices: 0 }), { status: 202 })));
    expect((await c.send(msg)).kind).toBe('skipped');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    expect((await c.send(msg)).kind).toBe('retry');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 400 })));
    expect((await c.send(msg)).kind).toBe('failed');
  });

  it('customer-api sink posts the event with its own key and throws on non-2xx', async () => {
    const fetch = vi.fn(async (_u: string, _i?: RequestInit) => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const sink = new CustomerApiRatingSink(config);
    const e = { id: 'ev1', tenantId: 't', aggregateType: 'rating_summary', aggregateId: 'sf', eventType: 'rating.summary.changed.v1', payload: { version: '3' }, createdAt: new Date(0), attempts: 0 };
    await sink.deliver(e);
    expect(fetch.mock.calls[0][0]).toBe('http://cust/internal/review-events/');
    expect((fetch.mock.calls[0][1]!.headers as any)['x-service-key']).toBe('ck');
    expect(JSON.parse(String(fetch.mock.calls[0][1]!.body))).toMatchObject({ id: 'ev1', type: 'rating.summary.changed.v1', payload: { version: '3' } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    await expect(sink.deliver(e)).rejects.toThrow('HTTP 500');
  });
});
