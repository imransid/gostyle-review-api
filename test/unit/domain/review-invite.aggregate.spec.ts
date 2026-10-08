import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../src/review/domain/domain.error';
import { INVITE_TTL_DAYS } from '../../../src/review/domain/services/review-invite-rules';
import { mintInvite, NOW } from './fixtures';

const DAY = 24 * 60 * 60 * 1000;
const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as DomainError).code;
  }
  return 'no error';
};

describe('ReviewInvite.mint', () => {
  it('holds only the hash, expires in 30 days, and is unused', () => {
    const { invite, token } = mintInvite();
    expect(invite.tokenHash).toBe(token.hash);
    expect(invite.tokenHash).not.toContain(token.reveal());
    expect(invite.expiresAt.getTime() - NOW.getTime()).toBe(INVITE_TTL_DAYS * DAY);
    expect(INVITE_TTL_DAYS).toBe(30);
    expect(invite.usedAt).toBeNull();
    expect(invite.sendStatus).toBe('PENDING');
  });

  it('records review.invite.created.v1 carrying the invite id and NEVER the token', () => {
    const { invite, token } = mintInvite();
    const [event] = invite.getUncommittedEvents() as any[];
    expect(event.type).toBe('review.invite.created.v1');
    const wire = JSON.stringify({ ...event, payload: event.payload() });
    expect(event.payload().inviteId).toBe(invite.id);
    expect(wire).not.toContain(token.reveal());
    expect(wire).not.toContain(token.hash);
  });
});

describe('redeem', () => {
  it('is single use', () => {
    const { invite } = mintInvite();
    invite.redeem(NOW);
    expect(invite.usedAt).toEqual(NOW);
    expect(codeOf(() => invite.redeem(NOW))).toBe('INVITE_ALREADY_USED');
  });

  it('expires at exactly 30 days', () => {
    const { invite } = mintInvite();
    expect(codeOf(() => invite.redeem(new Date(NOW.getTime() + 30 * DAY)))).toBe('INVITE_EXPIRED');
    const { invite: fresh } = mintInvite();
    expect(codeOf(() => fresh.redeem(new Date(NOW.getTime() + 30 * DAY - 1)))).toBe('no error');
  });

  it('says "already used" over "expired" when both are true', () => {
    const { invite } = mintInvite();
    invite.redeem(NOW);
    expect(invite.refusal(new Date(NOW.getTime() + 31 * DAY))).toBe('INVITE_ALREADY_USED');
  });
});

describe('send bookkeeping', () => {
  it('SENT is terminal: nothing after it changes the status', () => {
    const { invite } = mintInvite();
    invite.recordSend({ kind: 'sent', ref: null }, NOW, true);
    invite.recordSend({ kind: 'retry', error: 'x' }, NOW, true);
    expect(invite.sendStatus).toBe('SENT');
    expect(invite.sentAt).toEqual(NOW);
    expect(invite.rotateForRetry(NOW)).toBeNull();
  });

  it('a DEFINITE failure with retries left is RETRYING, and only that may rotate the token', () => {
    const { invite, token } = mintInvite();
    invite.recordSend({ kind: 'retry', error: 'HTTP 503' }, NOW, true);
    expect(invite.sendStatus).toBe('RETRYING');
    const fresh = invite.rotateForRetry(NOW);
    expect(fresh).not.toBeNull();
    expect(invite.tokenHash).toBe(fresh!.hash);
    expect(invite.tokenHash).not.toBe(token.hash);
  });

  it('a TIMEOUT may have landed, so it is UNKNOWN and is never retried', () => {
    const { invite } = mintInvite();
    invite.recordSend({ kind: 'unknown', error: 'timeout' }, NOW, true);
    expect(invite.sendStatus).toBe('UNKNOWN');
    expect(invite.rotateForRetry(NOW)).toBeNull();
  });

  it('out of retries is FAILED; no contact is NO_CONTACT', () => {
    const a = mintInvite().invite;
    a.recordSend({ kind: 'retry', error: 'HTTP 503' }, NOW, false);
    expect(a.sendStatus).toBe('FAILED');
    const b = mintInvite().invite;
    b.recordSend({ kind: 'no_contact' }, NOW, true);
    expect(b.sendStatus).toBe('NO_CONTACT');
    expect(b.sendAttempts).toBe(0);
  });

  it('never rotates a used or expired invite', () => {
    const { invite } = mintInvite();
    invite.recordSend({ kind: 'retry', error: 'x' }, NOW, true);
    invite.redeem(NOW);
    expect(invite.rotateForRetry(NOW)).toBeNull();
  });
});
