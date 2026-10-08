import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EVENT_DESTINATIONS, type EventDestination, type RelayedEvent } from './event-destination';

export const RELAY_BATCH_SIZE = 50;
/** After this many failures a row stops being retried and needs a human. */
export const MAX_ATTEMPTS = 20;
/** How long a claimed row is invisible to other relays while it is delivered. */
export const CLAIM_LEASE_SECONDS = 60;
/** Backoff ceiling between attempts. */
export const MAX_BACKOFF_SECONDS = 600;

/** 1s, 2s, 4s ... capped at ten minutes: twenty attempts span about two hours. */
export function backoffSeconds(attemptsSoFar: number): number {
  return Math.min(2 ** attemptsSoFar, MAX_BACKOFF_SECONDS);
}

interface ClaimedRow {
  id: string;
  tenant_id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: Date;
  attempts: number;
}

/**
 * Moves committed events out of outbox_event. At least once, never zero.
 *
 * Booking-api's relay delivers INSIDE the claiming transaction, holding row
 * locks and a connection across every HTTP call. This one claims with a lease
 * instead: one short statement marks a batch invisible for CLAIM_LEASE_SECONDS
 * (FOR UPDATE SKIP LOCKED, so two relays never claim the same row), delivers
 * outside any transaction, then records each outcome with its own update. A
 * relay that dies mid-batch simply lets the lease run out.
 */
@Injectable()
export class OutboxRelay {
  private static readonly log = new Logger(OutboxRelay.name);
  private readonly byType = new Map<string, EventDestination[]>();
  /** Log the first failure, then every thirtieth: an outage is not 300 lines. */
  private consecutiveFailures = 0;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EVENT_DESTINATIONS) destinations: EventDestination[],
  ) {
    for (const d of destinations) {
      for (const t of d.eventTypes) this.byType.set(t, [...(this.byType.get(t) ?? []), d]);
    }
  }

  /** One batch. Returns what happened, for the job log and the specs. */
  async drain(): Promise<{ claimed: number; delivered: number; failed: number }> {
    const rows = await this.prisma.$queryRaw<ClaimedRow[]>`
      UPDATE outbox_event
         SET next_attempt_at = now() + make_interval(secs => ${CLAIM_LEASE_SECONDS})
       WHERE id IN (
             SELECT id FROM outbox_event
              WHERE published_at IS NULL
                AND attempts < ${MAX_ATTEMPTS}
                AND (next_attempt_at IS NULL OR next_attempt_at <= now())
              ORDER BY created_at
              LIMIT ${RELAY_BATCH_SIZE}
                FOR UPDATE SKIP LOCKED)
      RETURNING id, tenant_id, aggregate_type, aggregate_id, event_type, payload, created_at, attempts`;
    rows.sort((a, b) => a.created_at.getTime() - b.created_at.getTime());

    let delivered = 0;
    let failed = 0;
    for (const row of rows) {
      const event: RelayedEvent = {
        id: row.id,
        tenantId: row.tenant_id,
        aggregateType: row.aggregate_type,
        aggregateId: row.aggregate_id,
        eventType: row.event_type,
        payload: row.payload,
        createdAt: row.created_at,
        attempts: row.attempts,
      };
      try {
        // An event with no destination is published as soon as it is seen:
        // audit and metrics events live in the table, nothing consumes them.
        for (const d of this.byType.get(event.eventType) ?? []) await d.deliver(event);
        await this.prisma.outboxEvent.update({
          where: { id: row.id },
          data: { publishedAt: new Date(), lastError: null, nextAttemptAt: null },
        });
        delivered += 1;
      } catch (e) {
        failed += 1;
        const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
        await this.prisma.$executeRaw`
          UPDATE outbox_event
             SET attempts = attempts + 1,
                 last_error = ${message},
                 next_attempt_at = now() + make_interval(secs => ${backoffSeconds(row.attempts)})
           WHERE id = ${row.id}::uuid`;
        OutboxRelay.log.warn(
          `${row.event_type} ${row.id} attempt ${row.attempts + 1}/${MAX_ATTEMPTS} failed: ${message}`,
        );
        if (row.attempts + 1 >= MAX_ATTEMPTS) {
          OutboxRelay.log.error(`${row.event_type} ${row.id} gave up after ${MAX_ATTEMPTS} attempts`);
        }
      }
    }
    if (delivered > 0) OutboxRelay.log.log(`published ${delivered} event(s)`);
    return { claimed: rows.length, delivered, failed };
  }

  /** drain(), never throwing: what the repeatable job calls every tick. */
  async tick(): Promise<void> {
    try {
      await this.drain();
      this.consecutiveFailures = 0;
    } catch (e) {
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures === 1 || this.consecutiveFailures % 30 === 0) {
        OutboxRelay.log.error(
          `relay tick failed (${this.consecutiveFailures}x): ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  /** Queue depth, for /health. The age of the oldest is the number that matters. */
  async stats(): Promise<{ pending: number; stuck: number; oldestPendingSeconds: number | null }> {
    const [r] = await this.prisma.$queryRaw<
      { pending: bigint; stuck: bigint; oldest: Date | null }[]
    >`
      SELECT count(*) FILTER (WHERE attempts < ${MAX_ATTEMPTS})  AS pending,
             count(*) FILTER (WHERE attempts >= ${MAX_ATTEMPTS}) AS stuck,
             min(created_at)                                     AS oldest
        FROM outbox_event WHERE published_at IS NULL`;
    return {
      pending: Number(r?.pending ?? 0),
      stuck: Number(r?.stuck ?? 0),
      oldestPendingSeconds: r?.oldest ? Math.round((Date.now() - r.oldest.getTime()) / 1000) : null,
    };
  }
}
