// Prisma 7 keeps three things here rather than in schema.prisma:
//   1. the datasource url
//   2. the migrations path
//   3. .env loading, which is now our job (hence dotenv/config)
//
// "dotenv/config" MUST be the first import: it fills process.env before
// DATABASE_URL below is read.
//
// This file configures the Prisma CLI (generate, migrate). It is the one place
// outside src/shared/config that reads process.env, because the CLI never
// boots the app. The running app gets its URL from AppConfig.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Falls back to an empty string rather than throwing: `prisma generate` runs in
// the Docker build with no database and only reads the schema. `migrate deploy`
// still fails loudly without a URL, which is the command that needs one.
// DATABASE_URL_FILE is honoured for the same reason AppConfig honours it.
function databaseUrl(): string {
  const file = process.env.DATABASE_URL_FILE?.trim();
  if (file) return readFileSync(file, 'utf8').trim();
  return process.env.DATABASE_URL ?? '';
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: databaseUrl(),
    // Only `yarn prisma:check` (schema vs migrations) needs it: Prisma replays
    // the migrations into this throwaway database and diffs the result.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL || undefined,
  },
});
