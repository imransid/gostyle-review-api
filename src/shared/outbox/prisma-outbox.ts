import { Injectable } from '@nestjs/common';
import type { TxHandle } from '../../review/domain/ports/unit-of-work.port';
import { DomainEvent } from '../../review/domain/shared/domain-event';
import { PrismaService } from '../prisma/prisma.service';
import { asPrisma } from '../prisma/prisma-tx';
import { type Inbox, type OutboxMessage, type OutboxWriter, toOutboxMessage } from './outbox.port';

@Injectable()
export class PrismaOutboxWriter implements OutboxWriter {
  constructor(private readonly prisma: PrismaService) {}

  async append(events: ReadonlyArray<DomainEvent | OutboxMessage>, tx: TxHandle): Promise<void> {
    if (events.length === 0) return;
    const rows = events.map((e) => (e instanceof DomainEvent ? toOutboxMessage(e) : e));
    await asPrisma(this.prisma, tx).outboxEvent.createMany({
      data: rows.map((m) => ({
        id: m.id,
        tenantId: m.tenantId,
        aggregateType: m.aggregateType,
        aggregateId: m.aggregateId,
        eventType: m.eventType,
        payload: m.payload as object,
        createdAt: m.occurredAt,
      })),
    });
  }
}

@Injectable()
export class PrismaInbox implements Inbox {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    e: { source: string; eventId: string; eventType: string; tenantId: string | null },
    tx: TxHandle,
  ): Promise<boolean> {
    // ON CONFLICT DO NOTHING: the primary key decides, atomically, whether
    // this delivery is the first.
    const inserted = await asPrisma(this.prisma, tx).$executeRaw`
      INSERT INTO inbox_event (source, event_id, event_type, tenant_id, outcome)
      VALUES (${e.source}, ${e.eventId}, ${e.eventType}, ${e.tenantId}::uuid, 'processing')
      ON CONFLICT (source, event_id) DO NOTHING`;
    return inserted === 1;
  }

  async setOutcome(
    e: { source: string; eventId: string; outcome: string; tenantId: string | null },
    tx: TxHandle,
  ): Promise<void> {
    await asPrisma(this.prisma, tx).inboxEvent.update({
      where: { source_eventId: { source: e.source, eventId: e.eventId } },
      data: { outcome: e.outcome, tenantId: e.tenantId },
    });
  }
}
