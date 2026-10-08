import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InviteDelivery, resendDelayMs } from '../../src/review/application/invites/invite-delivery';
import { ReviewInvite } from '../../src/review/domain/invite/review-invite.aggregate';
import type { SendOutcome } from '../../src/review/domain/invite/invite-send';
import { mintInvite, NOW } from './domain/fixtures';

function setup(outcomes: SendOutcome[], contact: unknown = { phone: '+971501234567', displayName: 'Sara' }, retries = 5) {
  const store = new Map<string, ReviewInvite>();
  const sent: any[] = [];
  const jobs: any[] = [];
  const sender = { send: vi.fn(async (m: any) => (sent.push(m), outcomes.shift() ?? { kind: 'sent', ref: null })) };
  const contacts = { find: vi.fn(async () => (contact instanceof Error ? Promise.reject(contact) : contact)) };
  const invites = {
    saveSendState: vi.fn(async (i: ReviewInvite) => void store.set(i.id, i)),
    saveRotatedToken: vi.fn(async (i: ReviewInvite) => i.sendStatus === 'RETRYING'),
    findById: vi.fn(async (id: string) => store.get(id) ?? null),
  };
  const queue = { add: vi.fn(async (...a: any[]) => void jobs.push(a)) };
  const config = { reviewPublicBaseUrl: 'https://gostyle.app/review', inviteSendRetryAttempts: retries } as any;
  const delivery = new InviteDelivery(contacts as any, sender as any, invites as any, queue as any, config, { now: () => NOW });
  return { delivery, sent, jobs, sender, invites, store };
}

afterEach(() => vi.restoreAllMocks());

describe('InviteDelivery.deliver', () => {
  it('sends a link carrying the token and nothing else, then records SENT', async () => {
    const { delivery, sent, jobs } = setup([{ kind: 'sent', ref: 'wamid.1' }]);
    const { invite, token } = mintInvite();
    expect(await delivery.deliver(invite, token)).toBe('SENT');
    expect(sent[0].url).toBe(`https://gostyle.app/review/${token.reveal()}`);
    expect(sent[0].body).toContain('Hi Sara,');
    expect(sent[0].body).toContain('Marina Walk');
    expect(jobs).toEqual([]);
  });

  it('a DEFINITE failure schedules a resend that carries the invite id ONLY', async () => {
    const { delivery, jobs } = setup([{ kind: 'retry', error: 'HTTP 503' }]);
    const { invite, token } = mintInvite();
    expect(await delivery.deliver(invite, token)).toBe('RETRYING');
    expect(jobs).toHaveLength(1);
    const [name, data, opts] = jobs[0];
    expect(name).toBe('invite-resend');
    expect(data).toEqual({ inviteId: invite.id });
    expect(JSON.stringify(jobs)).not.toContain(token.reveal());
    expect(opts.delay).toBe(60_000);
  });

  it('a timeout may have landed: UNKNOWN, and no resend', async () => {
    const { delivery, jobs } = setup([{ kind: 'unknown', error: 'timeout' }]);
    expect(await delivery.deliver(...Object.values(mintInvite()) as [any, any])).toBe('UNKNOWN');
    expect(jobs).toEqual([]);
  });

  it('no phone is NO_CONTACT, not an error, and nothing is sent', async () => {
    const { delivery, sender } = setup([], { phone: null, displayName: 'Sara' });
    const { invite, token } = mintInvite();
    expect(await delivery.deliver(invite, token)).toBe('NO_CONTACT');
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('a contact lookup outage is a retry: nothing was sent', async () => {
    const { delivery, sender } = setup([], new Error('platform down'));
    const { invite, token } = mintInvite();
    expect(await delivery.deliver(invite, token)).toBe('RETRYING');
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('with INVITE_SEND_RETRY_ATTEMPTS=0 a failed send is FAILED, as on the platform', async () => {
    const { delivery, jobs } = setup([{ kind: 'retry', error: 'HTTP 503' }], undefined, 0);
    const { invite, token } = mintInvite();
    expect(await delivery.deliver(invite, token)).toBe('FAILED');
    expect(jobs).toEqual([]);
  });

  it('NEVER logs the token, the phone or the body', async () => {
    const logs: string[] = [];
    vi.spyOn(Logger.prototype, 'log').mockImplementation((m: any) => void logs.push(String(m)));
    const { delivery } = setup([{ kind: 'retry', error: 'HTTP 503' }]);
    const { invite, token } = mintInvite();
    await delivery.deliver(invite, token);
    const all = logs.join('\n');
    expect(all).toContain(invite.booking.id);
    expect(all).not.toContain(token.reveal());
    expect(all).not.toContain('+971501234567');
  });
});

describe('InviteDelivery.resend: a failed send retries and finds the invite already there', () => {
  it('mints a FRESH token for the SAME invite, sends it, and a success is never repeated', async () => {
    const { delivery, sent, store } = setup([{ kind: 'retry', error: 'HTTP 503' }, { kind: 'sent', ref: 'w2' }]);
    const { invite, token } = mintInvite();
    await delivery.deliver(invite, token);
    const firstHash = invite.tokenHash;

    expect(await delivery.resend(invite.id)).toBe('SENT');
    const after = store.get(invite.id)!;
    expect(after.id).toBe(invite.id);
    expect(after.tokenHash).not.toBe(firstHash);
    expect(sent[1].url).not.toContain(token.reveal());
    expect(sent).toHaveLength(2);

    // A late duplicate of the job finds SENT and does nothing.
    expect(await delivery.resend(invite.id)).toBe('skipped');
    expect(sent).toHaveLength(2);
  });

  it('skips an invite that was used meanwhile', async () => {
    const { delivery, sent, store } = setup([{ kind: 'retry', error: 'x' }]);
    const { invite, token } = mintInvite();
    await delivery.deliver(invite, token);
    store.get(invite.id)!.redeem(NOW);
    expect(await delivery.resend(invite.id)).toBe('skipped');
    expect(sent).toHaveLength(1);
  });

  it('backs off 1, 2, 4 ... minutes, capped at an hour', () => {
    expect([1, 2, 3, 4, 10].map(resendDelayMs)).toEqual([60_000, 120_000, 240_000, 480_000, 3_600_000]);
  });
});
