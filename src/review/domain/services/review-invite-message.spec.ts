import { describe, it, expect } from 'vitest';
import { buildInviteUrl, inviteLocaleFrom, renderInviteMessage } from './review-invite-message';

describe('inviteLocaleFrom', () => {
  it('reads the tenant default', () => {
    expect(inviteLocaleFrom('en')).toBe('en');
    expect(inviteLocaleFrom('ar')).toBe('ar');
  });

  it('matches an Arabic regional tag', () => {
    expect(inviteLocaleFrom('ar-AE')).toBe('ar');
    expect(inviteLocaleFrom('AR')).toBe('ar');
  });

  it('FALLS TO ENGLISH for anything unrecognised, including unset', () => {
    // A wrong guess in English is readable. A wrong guess in Arabic is not.
    for (const junk of [null, undefined, '', '   ', 'fr', 'zz']) {
      expect(inviteLocaleFrom(junk), String(junk)).toBe('en');
    }
  });
});

describe('buildInviteUrl', () => {
  it('appends the token to the base', () => {
    expect(buildInviteUrl('https://gostyle.app/review', 'tok')).toBe(
      'https://gostyle.app/review/tok',
    );
  });

  it('tolerates trailing slashes on the base, however many', () => {
    // The base comes from config, and a trailing slash in a deployment manifest
    // must not produce a double-slashed link.
    expect(buildInviteUrl('https://gostyle.app/review/', 'tok')).toBe(
      'https://gostyle.app/review/tok',
    );
    expect(buildInviteUrl('https://gostyle.app/review///', 'tok')).toBe(
      'https://gostyle.app/review/tok',
    );
  });

  it('puts NOTHING but the token in the URL', () => {
    // Anything else would be a second identifier to leak and a second thing to
    // validate server-side.
    const url = buildInviteUrl('https://gostyle.app/review', 'tok');
    expect(url.split('/').pop()).toBe('tok');
    expect(url).not.toContain('?');
  });
});

describe('renderInviteMessage', () => {
  const copy = { salonName: 'Marina Walk', displayName: 'Sara', url: 'https://x/tok' };

  it('greets by name and names the salon, in English', () => {
    const body = renderInviteMessage('en', copy);
    expect(body).toContain('Hi Sara,');
    // Without the salon name this reads like spam from an unknown number,
    // which is what it will be reported as.
    expect(body).toContain('Marina Walk');
    expect(body).toContain('https://x/tok');
  });

  it('greets by name and names the salon, in Arabic', () => {
    const body = renderInviteMessage('ar', { ...copy, displayName: 'سارة' });
    expect(body).toContain('مرحبًا سارة،');
    expect(body).toContain('Marina Walk');
    expect(body).toContain('https://x/tok');
  });

  it('renders a COMPLETE greeting when there is no name, not one with a hole', () => {
    // A walk-in has no name on file. "Hi ," is worse than "Hi".
    for (const empty of [null, '', '   ']) {
      const en = renderInviteMessage('en', { ...copy, displayName: empty });
      expect(en).toContain('Hi,');
      expect(en).not.toContain('Hi ,');
      const ar = renderInviteMessage('ar', { ...copy, displayName: empty });
      expect(ar).toContain('مرحبًا،');
    }
  });

  it('never renders the literal string null or undefined', () => {
    const body = renderInviteMessage('en', { ...copy, displayName: null });
    expect(body).not.toMatch(/null|undefined/);
  });
});
