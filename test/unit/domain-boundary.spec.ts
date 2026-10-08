import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DOMAIN = join(__dirname, '../../src/review/domain');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

function imports(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  return [...src.matchAll(/(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

describe('the domain boundary', () => {
  const all = files(DOMAIN).filter((f) => !f.endsWith('.spec.ts'));

  it('has files to check', () => {
    expect(all.length).toBeGreaterThan(20);
  });

  it('imports nothing from Nest except @nestjs/cqrs', () => {
    const bad = all.flatMap((f) =>
      imports(f)
        .filter((i) => i.startsWith('@nestjs/') && i !== '@nestjs/cqrs')
        .map((i) => `${f}: ${i}`),
    );
    expect(bad).toEqual([]);
  });

  it('imports nothing from Prisma or any database driver', () => {
    const bad = all.flatMap((f) =>
      imports(f)
        .filter((i) => /prisma|^pg$|generated|ioredis|bullmq/i.test(i))
        .map((i) => `${f}: ${i}`),
    );
    expect(bad).toEqual([]);
  });

  it('never reaches outside src/review/domain', () => {
    const bad = all.flatMap((f) =>
      imports(f)
        .filter((i) => i.startsWith('.'))
        .filter((i) => !join(f, '..', i).startsWith(DOMAIN))
        .map((i) => `${f}: ${i}`),
    );
    expect(bad).toEqual([]);
  });
});
