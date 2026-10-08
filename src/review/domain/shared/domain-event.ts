import type { IEvent } from '@nestjs/cqrs';
import { uuidv7 } from './uuidv7';

/**
 * A fact the domain recorded. Written to the outbox in the same transaction as
 * the change, then relayed.
 *
 * `type` is the wire name, `<domain>.<verb>.v<n>`, the platform's convention.
 * The payload is what leaves the service, so it carries ids, never the invite
 * token and never contact details.
 */
export abstract class DomainEvent implements IEvent {
  abstract readonly type: string;
  abstract readonly aggregateType: string;
  readonly id: string;
  readonly occurredAt: Date;

  protected constructor(
    readonly aggregateId: string,
    readonly tenantId: string,
    occurredAt: Date,
  ) {
    this.id = uuidv7(occurredAt.getTime());
    this.occurredAt = occurredAt;
  }

  abstract payload(): Record<string, unknown>;
}
