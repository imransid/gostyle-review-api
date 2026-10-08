import type { DomainEvent } from '../../review/domain/shared/domain-event';
import type { TxHandle } from '../../review/domain/ports/unit-of-work.port';

export const OUTBOX_WRITER = Symbol('OUTBOX_WRITER');

/** One row for the outbox. A DomainEvent, or something built by hand. */
export interface OutboxMessage {
  id: string;
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
}

export function toOutboxMessage(e: DomainEvent): OutboxMessage {
  return {
    id: e.id,
    tenantId: e.tenantId,
    aggregateType: e.aggregateType,
    aggregateId: e.aggregateId,
    eventType: e.type,
    payload: e.payload(),
    occurredAt: e.occurredAt,
  };
}

/**
 * Write events IN THE CALLER'S TRANSACTION. Never a queue.add(): the push
 * service saved a row and then queued it, and a Redis blip between the two
 * left work that never ran. Here the event commits with the change or not at
 * all, and the relay moves it out afterwards.
 */
export interface OutboxWriter {
  append(events: ReadonlyArray<DomainEvent | OutboxMessage>, tx: TxHandle): Promise<void>;
}

export const INBOX = Symbol('INBOX');

/**
 * Events already handled, keyed (source, event id).
 *
 * record() is the FIRST write of a consumer's transaction. It returns false
 * when the event was seen before, and the consumer then does nothing. Because
 * the row commits with the consumer's effect, a failure part way leaves no
 * row and the redelivery runs again; a success leaves the row and the
 * redelivery stops.
 */
export interface Inbox {
  record(
    entry: { source: string; eventId: string; eventType: string; tenantId: string | null },
    tx: TxHandle,
  ): Promise<boolean>;
  setOutcome(
    entry: { source: string; eventId: string; outcome: string; tenantId: string | null },
    tx: TxHandle,
  ): Promise<void>;
}
