import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp, type E2E } from './app';

// bootApp writes into process.env, so each boot states SWAGGER_ENABLED itself.

describe('Swagger in production, SWAGGER_ENABLED unset', () => {
  let e: E2E;
  beforeAll(async () => {
    delete process.env.SWAGGER_ENABLED;
    e = await bootApp({ NODE_ENV: 'production' });
  });
  afterAll(() => e.close());

  it('serves no docs', async () => {
    expect((await e.http().get('/docs-json')).status).toBe(404);
    expect((await e.http().get('/docs')).status).toBe(404);
  });
});

describe('Swagger in production, SWAGGER_ENABLED=true', () => {
  let e: E2E;
  beforeAll(async () => {
    e = await bootApp({ NODE_ENV: 'production', SWAGGER_ENABLED: 'true' });
  });
  afterAll(async () => {
    await e.close();
    delete process.env.SWAGGER_ENABLED;
  });

  it('serves the document, listing the routes of every surface', async () => {
    const res = await e.http().get('/docs-json');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining([
        '/health',
        '/v1/public/reviews/{token}',
        '/v1/storefront/reviews',
        '/v1/platform/review-reports',
        '/internal/ratings',
      ]),
    );
  });
});
