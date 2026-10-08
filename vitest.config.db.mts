import { defineConfig } from 'vitest/config';

// Repositories and constraints against a REAL Postgres (the local review-db).
// Serial: the specs share one database and clean their own tables.
export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/db/**/*.spec.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
