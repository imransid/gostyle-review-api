import { defineConfig } from 'vitest/config';

// The booted app over HTTP, against the local review-db and review-redis.
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
