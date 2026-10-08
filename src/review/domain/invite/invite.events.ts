import { DomainEvent } from '../shared/domain-event';

/**
 * An invite was minted. Metrics only.
 *
 * THE TOKEN IS NOT HERE, and must never be: the event carries the invite id.
 * Anyone holding the token can review that booking.
 */
export class InviteCreated extends DomainEvent {
  readonly type = 'review.invite.created.v1';
  readonly aggregateType = 'review_invite';
  constructor(
    inviteId: string,
    tenantId: string,
    at: Date,
    private readonly data: {
      storefrontId: string;
      branchId: string;
      bookingSource: string;
      bookingId: string;
      expiresAt: string;
    },
  ) {
    super(inviteId, tenantId, at);
  }
  payload() {
    return { inviteId: this.aggregateId, ...this.data };
  }
}
