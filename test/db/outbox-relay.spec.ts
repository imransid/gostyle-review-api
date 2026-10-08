import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from '../../src/review/domain/shared/uuidv7';
import type { EventDestination, RelayedEvent } from '../../src/shared/outbox/event-destination';
import { backoffSeconds, MAX_ATTEMPTS, OutboxRelay } from '../../src/shared/outbox/outbox-relay';
import { harness, resetTables, testPrisma } from './harness';

const prisma = testPrisma();

beforeEach(() => resetTables(prisma));
afterAll(() => prisma.$disconnect());

class Recorder implements EventDestination {
  readonly name = 'recorder';
  readonly seen: RelayedEvent[] = [];
  failFor = new Set<string>();
  constructor(readonly eventTypes: string[]) {}
  async deliver(e: RelayedEvent) {
    if (this.failFor.has(e.id)) throw new Error('HTTP 503 from consumer');
    this.seen.push(e);
  }
}

async function enqueue(n: number, eventType = 'test.thing.v1') {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = uuidv7();
    ids.push(id);
    await prisma.outboxEvent.create({
      data: {
        id,
        tenantId: uuidv7(),
        aggregateType: 'test',
        aggregateId: uuidv7(),
        eventType,
        payload: { n: i },
        createdAt: new Date(Date.UTC(2026, 9, 8, 0, 0, i)),
      },
    });
  }
  return ids;
}

describe('OutboxRelay', () => {
  it('delivers in created order and marks each published', async () => {
    const ids = await enqueue(5);
    const dest = new Recorder(['test.thing.v1']);
    const r = await new OutboxRelay(prisma, [dest]).drain();
    expect(r).toEqual({ claimed: 5, delivered: 5, failed: 0 });
    expect(dest.seen.map((e) => e.id)).toEqual(ids);
    expect(await prisma.outboxEvent.count({ where: { publishedAt: null } })).toBe(0);
  });

  it('a failing event is retried later with backoff and does not block the others', async () => {
    const [bad, ...good] = await enqueue(3);
    const dest = new Recorder(['test.thing.v1']);
    dest.failFor.add(bad);
    const r = await new OutboxRelay(prisma, [dest]).drain();
    expect(r).toEqual({ claimed: 3, delivered: 2, failed: 1 });
    expect(dest.seen.map((e) => e.id)).toEqual(good);
    const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: bad } });
    expect(row).toMatchObject({ attempts: 1, publishedAt: null, lastError: 'HTTP 503 from consumer' });
    expect(row.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
    // Not due yet, so the next drain leaves it alone.
    expect((await new OutboxRelay(prisma, [dest]).drain()).claimed).toBe(0);
  });

  it('backs off exponentially, capped at ten minutes, and stops at MAX_ATTEMPTS', async () => {
    expect([0, 1, 2, 3, 10, 30].map(backoffSeconds)).toEqual([1, 2, 4, 8, 600, 600]);
    const [id] = await enqueue(1);
    await prisma.outboxEvent.update({ where: { id }, data: { attempts: MAX_ATTEMPTS } });
    expect((await new OutboxRelay(prisma, []).drain()).claimed).toBe(0);
    expect((await new OutboxRelay(prisma, []).stats()).stuck).toBe(1);
  });

  it('an event nothing consumes is published at once', async () => {
    await enqueue(2, 'review.report.filed.v1');
    expect((await new OutboxRelay(prisma, []).drain()).delivered).toBe(2);
  });

  it('two relays draining at once never deliver the same event twice', async () => {
    await enqueue(40);
    const dest = new Recorder(['test.thing.v1']);
    const relays = Array.from({ length: 4 }, () => new OutboxRelay(prisma, [dest]));
    await Promise.all(relays.map((r) => r.drain()));
    const ids = dest.seen.map((e) => e.id);
    expect(ids).toHaveLength(40);
    expect(new Set(ids).size).toBe(40);
  });

  it('carries the events the handlers wrote, after they commit', async () => {
    const h = harness(prisma);
    const s = h.storefronts.add();
    await h.review(s, 4);
    const dest = new Recorder(['review.submitted.v1', 'rating.summary.changed.v1', 'review.invite.created.v1']);
    await new OutboxRelay(prisma, [dest]).drain();
    expect(dest.seen.map((e) => e.eventType).sort()).toEqual([
      'rating.summary.changed.v1',
      'review.invite.created.v1',
      'review.submitted.v1',
    ]);
    const summary = dest.seen.find((e) => e.eventType === 'rating.summary.changed.v1')!;
    expect(summary.payload).toMatchObject({ storefrontId: s.storefrontId, reviewCount: 1, average: 4 });
  });
});
