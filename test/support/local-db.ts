import { execFileSync } from 'node:child_process';
import { Client } from 'pg';

/**
 * The database the DB specs and the e2e specs use: `review_test` on the LOCAL
 * review-db container. Never the dev database (the specs truncate tables), and
 * never anything that is not this machine's review-db on port 5435.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://review:change-me-db@127.0.0.1:5435/review_test';

export function assertLocal(url: string): void {
  const u = new URL(url);
  const local = ['127.0.0.1', 'localhost', '::1'].includes(u.hostname);
  const ci = process.env.CI === 'true' && u.hostname === '127.0.0.1';
  if (!(local && (u.port === '5435' || ci))) {
    throw new Error(`refusing to run DB specs against ${u.hostname}:${u.port}: local review-db only`);
  }
  if (!u.pathname.endsWith('_test')) {
    throw new Error('refusing to run DB specs against a database whose name does not end in _test');
  }
}

/** Create review_test if needed and apply every migration to it. */
export async function prepareTestDatabase(): Promise<void> {
  assertLocal(TEST_DATABASE_URL);
  const u = new URL(TEST_DATABASE_URL);
  const name = u.pathname.slice(1);
  const admin = new URL(TEST_DATABASE_URL);
  admin.pathname = '/postgres';
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (exists.rowCount === 0) await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end();
  }
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, DATABASE_URL_FILE: '' },
    stdio: 'pipe',
  });
}
