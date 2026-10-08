#!/usr/bin/env node
// Runs scripts/proof.sql and checks that every test did what it declared:
// a MUST FAIL that printed no ERROR, or a MUST PASS that did, fails the run.
//
// Target: PROOF_DATABASE_URL, else the local review_test database. Refuses any
// host but this machine's review-db (5435), except in CI.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const url =
  process.env.PROOF_DATABASE_URL ??
  process.env.TEST_DATABASE_URL ??
  'postgresql://review:change-me-db@127.0.0.1:5435/review_test';

const u = new URL(url);
const local = ['127.0.0.1', 'localhost'].includes(u.hostname) && u.port === '5435';
if (!local && process.env.CI !== 'true') {
  console.error(`refusing to run the proof against ${u.hostname}:${u.port}: local review-db only`);
  process.exit(2);
}

const file = join(dirname(fileURLToPath(import.meta.url)), 'proof.sql');
// stderr folded into stdout by psql itself (2>&1 in one stream keeps order).
const run = spawnSync('sh', ['-c', `psql "$URL" -X -f "$FILE" 2>&1`], {
  env: { ...process.env, URL: url, FILE: file, PAGER: '' },
  encoding: 'utf8',
});
const out = run.stdout ?? '';
process.stdout.write(out);

const tests = [];
let current = null;
for (const line of out.split('\n')) {
  const m = line.match(/=== TEST (\d+): (.*) MUST (FAIL|PASS)\. ===/);
  if (m) {
    current = { n: Number(m[1]), what: m[2].trim(), must: m[3], errors: [] };
    tests.push(current);
    continue;
  }
  if (line.startsWith('=== ')) current = null;
  if (current && /ERROR:/.test(line)) current.errors.push(line.replace(/^.*ERROR:\s*/, ''));
}

let bad = 0;
console.log('\n─── proof summary ───');
for (const t of tests) {
  const failed = t.errors.length > 0;
  const ok = (t.must === 'FAIL') === failed;
  if (!ok) bad += 1;
  const why = failed ? t.errors[0] : 'no error';
  console.log(`${ok ? 'ok  ' : 'BAD '} TEST ${String(t.n).padStart(2)} MUST ${t.must}: ${why}`);
}
console.log(`${tests.length} tests, ${tests.length - bad} as declared, ${bad} not`);
process.exit(bad === 0 && tests.length > 0 ? 0 : 1);
