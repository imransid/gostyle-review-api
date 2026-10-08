import { defineConfig } from 'vitest/config';

// The booted app over HTTP, against the local review_test database, the local
// review-redis and a fake gostyle-api (test/support/fake-platform.ts).
export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/e2e/**/*.e2e-spec.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
