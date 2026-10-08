import { defineConfig } from 'vitest/config';

// Repositories, handlers and constraints against a REAL Postgres: the
// review_test database on the local review-db container (see
// test/support/local-db.ts, which refuses anything else).
// Serial: the specs share one database and clean their own tables.
export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/db/**/*.spec.ts'],
    globalSetup: ['test/db/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
