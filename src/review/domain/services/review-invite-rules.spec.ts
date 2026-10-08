import { describe, it, expect } from 'vitest';
import {
  hashInviteToken,
  INVITE_TTL_DAYS,
  inviteExpiryFrom,
  mintInviteToken,
  refuseInvite,
} from './review-invite-rules';

const NOW = new Date('2026-08-07T12:00:00.000Z');

describe('mintInviteToken', () => {
  it('returns a token and the hash that will actually be stored', () => {
    const { token, tokenHash } = mintInviteToken();
    expect(token.length).toBeGreaterThan(30);
    expect(tokenHash).toBe(hashInviteToken(token));
    // sha256 hex.
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('NEVER returns the same token twice', () => {
    const seen = new Set(Array.from({ length: 200 }, () => mintInviteToken().token));
    expect(seen.size).toBe(200);
  });

  it('is URL-safe, because this token lives in a link in a WhatsApp message', () => {
    for (let i = 0; i < 50; i++) {
      expect(mintInviteToken().token).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('THE HASH IS NOT THE TOKEN, which is the whole point of storing it', () => {
    const { token, tokenHash } = mintInviteToken();
    expect(tokenHash).not.toBe(token);
    expect(tokenHash).not.toContain(token);
  });
});

describe('inviteExpiryFrom', () => {
  it('is thirty days out', () => {
    const expiry = inviteExpiryFrom(NOW);
    expect(expiry.getTime() - NOW.getTime()).toBe(INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
  });
});

describe('refuseInvite', () => {
  const live = { expiresAt: new Date(NOW.getTime() + 1000), usedAt: null };

  it('allows a live, unused invite', () => {
    expect(refuseInvite(live, NOW)).toBeNull();
  });

  it('reports a missing invite distinctly from a spent one', () => {
    // Different situations send a customer to different places: "this link is
    // not real" and "you already reviewed this" are not the same message.
    expect(refuseInvite(null, NOW)).toBe('INVITE_NOT_FOUND');
    expect(refuseInvite({ ...live, usedAt: NOW }, NOW)).toBe('INVITE_ALREADY_USED');
  });

  it('reports an expired invite', () => {
    expect(refuseInvite({ expiresAt: new Date(NOW.getTime() - 1), usedAt: null }, NOW)).toBe(
      'INVITE_EXPIRED',
    );
  });

  it('treats the exact expiry instant as expired', () => {
    expect(refuseInvite({ expiresAt: NOW, usedAt: null }, NOW)).toBe('INVITE_EXPIRED');
  });

  it('PREFERS "already used" over "expired" when both are true', () => {
    // The more informative of the two, and the one that will not change. A
    // customer told "expired" would reasonably ask for a new link; the honest
    // answer is that they already left the review.
    const spentAndStale = { expiresAt: new Date(NOW.getTime() - 1000), usedAt: NOW };
    expect(refuseInvite(spentAndStale, NOW)).toBe('INVITE_ALREADY_USED');
  });
});
