import { afterEach, describe, expect, it, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { HttpPermissionResolver } from '../../src/shared/auth/permission-resolver';
import { InvalidTokenError, secretFingerprint, verifyPlatformToken } from '../../src/shared/auth/platform-token';
import { ServiceKeyGuard } from '../../src/shared/auth/service-key.guard';
import { platformToken } from '../support/tokens';

const keys = { platform: 'k-platform', 'booking-api': 'k-booking', 'customer-api': 'k-customer', ops: 'k-ops' };

describe('ServiceKeyGuard.identify', () => {
  const guard = new ServiceKeyGuard(new Reflector(), { serviceKeys: keys } as any);

  it('names the caller a key belongs to', () => {
    expect(guard.identify('k-booking')).toBe('booking-api');
    expect(guard.identify('k-ops')).toBe('ops');
  });

  it('knows no caller for a wrong, empty, longer or shorter key', () => {
    for (const k of ['', 'k-booking ', 'k-bookin', 'K-BOOKING', 'k-booking-and-more']) {
      expect(guard.identify(k)).toBeNull();
    }
  });
});

describe('verifyPlatformToken', () => {
  const secret = 'unit-secret';

  it('reads the claims of a gostyle-api token', () => {
    const p = verifyPlatformToken(
      platformToken(secret, { sub: 'u1', tenantId: 't1', branchId: 'b1', actor: 'tenant_user', roles: ['salon_admin'] }),
      secret,
    );
    expect(p).toMatchObject({ userId: 'u1', tenantId: 't1', branchId: 'b1', actor: 'tenant_user', roles: ['salon_admin'] });
  });

  it('does NOT default a missing tenant', () => {
    expect(verifyPlatformToken(platformToken(secret, { sub: 'hq' }), secret).tenantId).toBeNull();
  });

  it('refuses another issuer, another secret, an expired token and garbage', () => {
    const bad = [
      platformToken(secret, { sub: 'u' }, { issuer: 'gostyle-consumer' }),
      platformToken('other', { sub: 'u' }),
      platformToken(secret, { sub: 'u' }, { expiresIn: -1 }),
      'not.a.jwt',
    ];
    for (const t of bad) expect(() => verifyPlatformToken(t, secret)).toThrow(InvalidTokenError);
  });

  it('fingerprints without revealing', () => {
    expect(secretFingerprint('abc')).toMatch(/^[0-9a-f]{12}$/);
    expect(secretFingerprint('abc')).not.toContain('abc');
  });
});

describe('HttpPermissionResolver', () => {
  afterEach(() => vi.unstubAllGlobals());
  const config = { platform: { apiUrl: 'http://platform' }, httpTimeoutMs: 1000, permissionCacheTtlMs: 60_000 } as any;
  const principal = { token: 't-1', userId: 'u' } as any;

  it("asks /v1/auth/me with the caller's own token, and caches the answer", async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ perms: ['a', 'b'] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const r = new HttpPermissionResolver(config);
    expect(await r.permissionsOf(principal)).toEqual(['a', 'b']);
    expect(await r.permissionsOf(principal)).toEqual(['a', 'b']);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('http://platform/v1/auth/me');
    expect((fetch.mock.calls[0] as any)[1].headers.authorization).toBe('Bearer t-1');
  });

  it('null when the platform refuses the token; throws (never allows) when it is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    expect(await new HttpPermissionResolver(config).permissionsOf(principal)).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 502 })));
    await expect(new HttpPermissionResolver(config).permissionsOf(principal)).rejects.toThrow(/HTTP 502/);
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))));
    await expect(new HttpPermissionResolver(config).permissionsOf(principal)).rejects.toThrow(/permission lookup failed/);
  });
});
