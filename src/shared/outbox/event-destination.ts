/** An outbox row on its way out. */
export interface RelayedEvent {
  id: string;
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: Date;
  attempts: number;
}

/**
 * Somewhere an event goes once it leaves the outbox: an HTTP consumer in
 * another service, or a handler in this one (the reply push).
 *
 * deliver() THROWS when the event did not land, and the relay retries it
 * later with backoff. So it must be safe to call twice for the same event:
 * delivery is at least once, and every receiver dedupes by event id.
 */
export interface EventDestination {
  readonly name: string;
  readonly eventTypes: readonly string[];
  deliver(event: RelayedEvent): Promise<void>;
}

export const EVENT_DESTINATIONS = Symbol('EVENT_DESTINATIONS');
