import { DomainEvent } from '../shared/domain-event';
import type { ReviewState } from './review-state';

abstract class ReviewEvent extends DomainEvent {
  readonly aggregateType = 'review';
}

/** A customer redeemed a token. Feeds the rating summary. */
export class ReviewSubmitted extends ReviewEvent {
  readonly type = 'review.submitted.v1';
  constructor(
    reviewId: string,
    tenantId: string,
    occurredAt: Date,
    private readonly data: {
      storefrontId: string;
      branchId: string;
      inviteId: string;
      bookingSource: string;
      bookingId: string;
      rating: number;
      language: string;
    },
  ) {
    super(reviewId, tenantId, occurredAt);
  }
  payload() {
    return { reviewId: this.aggregateId, ...this.data };
  }
}

/** Why a moderation state change happened. */
export type ModerationCause = 'moderation' | 'report_upheld';

export interface ModerationData {
  storefrontId: string;
  from: ReviewState;
  to: ReviewState;
  moderatedById: string;
  cause: ModerationCause;
  reportId: string | null;
}

export class ReviewHidden extends ReviewEvent {
  readonly type = 'review.hidden.v1';
  constructor(id: string, tenantId: string, at: Date, private readonly data: ModerationData) {
    super(id, tenantId, at);
  }
  payload() {
    return { reviewId: this.aggregateId, ...this.data };
  }
}

export class ReviewRestored extends ReviewEvent {
  readonly type = 'review.restored.v1';
  constructor(id: string, tenantId: string, at: Date, private readonly data: ModerationData) {
    super(id, tenantId, at);
  }
  payload() {
    return { reviewId: this.aggregateId, ...this.data };
  }
}

export class ReviewRemoved extends ReviewEvent {
  readonly type = 'review.removed.v1';
  constructor(id: string, tenantId: string, at: Date, private readonly data: ModerationData) {
    super(id, tenantId, at);
  }
  payload() {
    return { reviewId: this.aggregateId, ...this.data };
  }
}

/** The salon answered. Drives the push to the customer. */
export class ReplyPosted extends ReviewEvent {
  readonly type = 'review.reply.posted.v1';
  constructor(
    reviewId: string,
    tenantId: string,
    at: Date,
    private readonly data: { replyId: string; storefrontId: string },
  ) {
    super(reviewId, tenantId, at);
  }
  payload() {
    return { reviewId: this.aggregateId, ...this.data };
  }
}

export class ReplyEdited extends ReviewEvent {
  readonly type = 'review.reply.edited.v1';
  constructor(
    reviewId: string,
    tenantId: string,
    at: Date,
    private readonly data: { replyId: string; storefrontId: string; editedById: string },
  ) {
    super(reviewId, tenantId, at);
  }
  payload() {
    return { reviewId: this.aggregateId, ...this.data };
  }
}

export class ReplyDeleted extends ReviewEvent {
  readonly type = 'review.reply.deleted.v1';
  constructor(
    reviewId: string,
    tenantId: string,
    at: Date,
    private readonly data: { replyId: string; storefrontId: string },
  ) {
    super(reviewId, tenantId, at);
  }
  payload() {
    return { reviewId: this.aggregateId, ...this.data };
  }
}
