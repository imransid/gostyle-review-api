import { Injectable, Logger } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import type { ServiceCaller } from '../../../shared/config/app-config';
import { isUuid } from '../../domain/shared/uuidv7';
import type { BookingSource } from '../../domain/value-objects/booking-ref';
import { CreateReviewInviteCommand } from '../commands/create-review-invite/create-review-invite.command';
import type { CreateReviewInviteResult } from '../commands/create-review-invite/create-review-invite.handler';
import { InviteDelivery } from '../invites/invite-delivery';

/** An event as it arrives over HTTP from a source's outbox relay. */
export interface IncomingEvent {
  /** The source's outbox row id: the dedupe key, with the caller. */
  id: string;
  type: string;
  /** The booking id. */
  aggregateId: string;
  tenantId?: string | null;
  occurredAt?: string;
  payload?: Record<string, unknown> | null;
}

/** Which event, from which caller, means "this booking completed". */
export const COMPLETION_EVENTS: Record<string, { caller: ServiceCaller; source: BookingSource }> = {
  'bookings.booking.completed.v1': { caller: 'platform', source: 'platform' },
  'booking.completed': { caller: 'booking-api', source: 'booking_api' },
};

export type ConsumeOutcome =
  | CreateReviewInviteResult['outcome']
  | 'ignored'
  | 'malformed';

const uuidOrNull = (v: unknown): string | null => (isUuid(v) ? v.toLowerCase() : null);

/**
 * A booking completed, in either booking system: mint the invite, then send.
 *
 * IDEMPOTENT. The inbox row (caller, event id) is written FIRST, in the same
 * transaction as the invite, so a redelivered event does nothing, and a
 * delivery that failed half way left nothing behind and runs again.
 *
 * MINT FIRST, SEND LAST. The send runs only after the invite committed. A
 * redelivery stops at the inbox (or at one-invite-per-booking) before it
 * could send twice, and a failed send is retried by the resend job, which
 * finds the invite already there.
 *
 * A malformed event (no booking, no branch) is acknowledged and ignored: it
 * will not grow the missing fields on redelivery, and retrying it forever
 * fixes nothing.
 */
@Injectable()
export class BookingCompletedConsumer {
  private static readonly log = new Logger(BookingCompletedConsumer.name);

  constructor(
    private readonly commands: CommandBus,
    private readonly delivery: InviteDelivery,
  ) {}

  async consume(caller: ServiceCaller, e: IncomingEvent): Promise<{ outcome: ConsumeOutcome; sendStatus?: string }> {
    const known = COMPLETION_EVENTS[e.type];
    if (!known || known.caller !== caller) return { outcome: 'ignored' };

    const payload = e.payload ?? {};
    const bookingId = uuidOrNull(e.aggregateId);
    const branchId = uuidOrNull(payload.branchId);
    if (!bookingId || !branchId || typeof e.id !== 'string' || e.id.trim() === '') {
      BookingCompletedConsumer.log.warn(`${caller} ${e.type} ${String(e.id)}: malformed, ignored`);
      return { outcome: 'malformed' };
    }

    const result: CreateReviewInviteResult = await this.commands.execute(
      new CreateReviewInviteCommand({
        bookingSource: known.source,
        bookingId,
        branchId,
        // The tenant the source names, when it names one: checked against the
        // storefront's owner, never used to pick one.
        tenantId: uuidOrNull(e.tenantId) ?? uuidOrNull(payload.tenantId),
        customerId: uuidOrNull(payload.customerId),
        inbox: { source: caller, eventId: e.id, eventType: e.type },
      }),
    );

    if (result.outcome !== 'invite_minted' || !result.invite || !result.token) {
      return { outcome: result.outcome };
    }
    // SEND LAST, after the commit above.
    const sendStatus = await this.delivery.deliver(result.invite, result.token);
    return { outcome: result.outcome, sendStatus };
  }
}
