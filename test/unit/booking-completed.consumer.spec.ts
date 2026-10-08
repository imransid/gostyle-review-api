import { describe, expect, it, vi } from 'vitest';
import { BookingCompletedConsumer } from '../../src/review/application/consumers/booking-completed.consumer';
import { CreateReviewInviteCommand } from '../../src/review/application/commands/create-review-invite/create-review-invite.command';
import { mintInvite, BRANCH, BOOKING, CUSTOMER, TENANT } from './domain/fixtures';

function setup(outcome = 'invite_minted') {
  const order: string[] = [];
  const minted = mintInvite();
  const commands = {
    execute: vi.fn(async (_cmd: CreateReviewInviteCommand) => {
      order.push('mint');
      return outcome === 'invite_minted'
        ? { outcome, invite: minted.invite, token: minted.token }
        : { outcome, invite: null, token: null };
    }),
  };
  const delivery = { deliver: vi.fn(async () => (order.push('send'), 'SENT')) };
  return { consumer: new BookingCompletedConsumer(commands as any, delivery as any), commands, delivery, order };
}

const platformEvent = {
  id: 'outbox-1',
  type: 'bookings.booking.completed.v1',
  aggregateId: BOOKING,
  tenantId: TENANT,
  payload: { branchId: BRANCH, customerId: CUSTOMER, staffId: 'x', serviceIds: [] },
};

describe('BookingCompletedConsumer', () => {
  it('MINT FIRST, SEND LAST', async () => {
    const { consumer, order, commands } = setup();
    expect(await consumer.consume('platform', platformEvent)).toEqual({ outcome: 'invite_minted', sendStatus: 'SENT' });
    expect(order).toEqual(['mint', 'send']);
    const cmd = commands.execute.mock.calls[0][0] as CreateReviewInviteCommand;
    expect(cmd.input).toMatchObject({
      bookingSource: 'platform',
      bookingId: BOOKING,
      branchId: BRANCH,
      tenantId: TENANT,
      customerId: CUSTOMER,
      inbox: { source: 'platform', eventId: 'outbox-1', eventType: 'bookings.booking.completed.v1' },
    });
  });

  it('a redelivery (duplicate_event) or a second completion (already_invited) sends NOTHING', async () => {
    for (const outcome of ['duplicate_event', 'already_invited', 'no_storefront', 'tenant_mismatch']) {
      const { consumer, delivery } = setup(outcome);
      expect((await consumer.consume('platform', platformEvent)).outcome).toBe(outcome);
      expect(delivery.deliver).not.toHaveBeenCalled();
    }
  });

  it('maps booking-api completions to booking_api, tenant from the payload when the envelope has none', async () => {
    const { consumer, commands } = setup();
    await consumer.consume('booking-api', {
      id: 'ba-7',
      type: 'booking.completed',
      aggregateId: BOOKING,
      payload: { branchId: BRANCH, customerId: CUSTOMER, tenantId: TENANT },
    });
    expect((commands.execute.mock.calls[0][0] as CreateReviewInviteCommand).input).toMatchObject({
      bookingSource: 'booking_api',
      tenantId: TENANT,
      inbox: { source: 'booking-api', eventId: 'ba-7' },
    });
  });

  it('ignores an event type from the wrong caller, and acknowledges a malformed one', async () => {
    const { consumer, commands } = setup();
    expect(await consumer.consume('booking-api', platformEvent)).toEqual({ outcome: 'ignored' });
    expect(await consumer.consume('platform', { ...platformEvent, payload: {} })).toEqual({ outcome: 'malformed' });
    expect(await consumer.consume('platform', { ...platformEvent, aggregateId: 'GS-1050' })).toEqual({ outcome: 'malformed' });
    expect(commands.execute).not.toHaveBeenCalled();
  });
});
