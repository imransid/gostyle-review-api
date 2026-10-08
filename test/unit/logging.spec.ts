import { describe, expect, it } from 'vitest';
import { redactUrl, requestIdFor } from '../../src/shared/logging/logging';
import { poolConfig } from '../../src/shared/prisma/prisma.service';

describe('redactUrl', () => {
  const token = 'q1W2e3R4t5Y6u7I8o9P0a1S2d3F4g5H6j7K8l9Z0x1C';

  it('removes the invite token from both public token routes', () => {
    expect(redactUrl(`/v1/public/reviews/${token}`)).toBe('/v1/public/reviews/[token]');
    expect(redactUrl(`/v1/public/review-invites/${token}?x=1`)).toBe(
      '/v1/public/review-invites/[token]?x=1',
    );
  });

  it('leaves every other URL alone', () => {
    expect(redactUrl('/v1/storefront/reviews/123/reply')).toBe('/v1/storefront/reviews/123/reply');
    expect(redactUrl('/health')).toBe('/health');
  });
});

describe('requestIdFor', () => {
  const res = () => {
    const headers: Record<string, string> = {};
    return { headers, setHeader: (k: string, v: string) => void (headers[k] = v) } as any;
  };

  it('reuses a sane incoming x-request-id and echoes it', () => {
    const r = res();
    expect(requestIdFor({ headers: { 'x-request-id': 'abc-123' } } as any, r)).toBe('abc-123');
    expect(r.headers['x-request-id']).toBe('abc-123');
  });

  it('mints one when the incoming id is absent or not sane', () => {
    const id = requestIdFor({ headers: { 'x-request-id': 'bad id\nwith newline' } } as any, res());
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('poolConfig', () => {
  it('pins every session to UTC', () => {
    expect(poolConfig('postgresql://x').options).toBe('-c timezone=UTC');
  });
});
