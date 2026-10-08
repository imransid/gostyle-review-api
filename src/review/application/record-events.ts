import type { AggregateRoot } from '@nestjs/cqrs';
import type { OutboxWriter } from '../../shared/outbox/outbox.port';
import type { TxHandle } from '../domain/ports/unit-of-work.port';
import type { DomainEvent } from '../domain/shared/domain-event';

/**
 * Write the aggregates' pending events to the outbox, in the caller's
 * transaction, and clear them. Events leave through the relay, never through
 * the in-process bus, so nothing happens on their account unless the change
 * that raised them commits.
 */
export async function recordEvents(
  outbox: OutboxWriter,
  tx: TxHandle,
  ...aggregates: AggregateRoot[]
): Promise<void> {
  const events = aggregates.flatMap((a) => a.getUncommittedEvents() as DomainEvent[]);
  await outbox.append(events, tx);
  for (const a of aggregates) a.uncommit();
}
