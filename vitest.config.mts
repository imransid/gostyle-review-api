import { defineConfig } from 'vitest/config';

// Unit specs only: domain specs beside their source, and test/unit. No
// database, no Redis. DB specs run under vitest.config.db.ts.
export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts', 'test/unit/**/*.spec.ts'],
  },
});
