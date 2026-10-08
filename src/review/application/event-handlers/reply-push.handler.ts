import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import type { EventDestination, RelayedEvent } from '../../../shared/outbox/event-destination';
import {
  PUSH_RECIPIENTS,
  PUSH_SENDER,
  type PushRecipients,
  type PushSender,
} from '../../domain/ports/push-sender.port';

export const REPLY_POSTED = 'review.reply.posted.v1';

/** The push service sends at most once per eventId. One reply, one push. */
export const replyPushEventId = (reviewId: string) => `review:${reviewId}:reply`;

/**
 * "The salon replied to your review", through push-notification-service.
 *
 * Runs from the outbox relay, so it only ever fires for a reply that
 * committed. A customer with no resolvable push user (a platform booking,
 * while the account mapping is open) is a logged SKIP, never a failure.
 * Only a transient push-service failure throws, and the relay retries it.
 */
@Injectable()
export class ReplyPushHandler implements EventDestination {
  private static readonly log = new Logger(ReplyPushHandler.name);
  readonly name = 'reply-push';
  readonly eventTypes = [REPLY_POSTED];

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PUSH_RECIPIENTS) private readonly recipients: PushRecipients,
    @Inject(PUSH_SENDER) private readonly push: PushSender,
  ) {}

  async deliver(e: RelayedEvent): Promise<void> {
    const reviewId = e.aggregateId;
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      select: {
        bookingSource: true,
        customerId: true,
        storefrontId: true,
        invite: { select: { salonName: true } },
      },
    });
    if (!review) return;

    const userId = await this.recipients.userFor({
      bookingSource: review.bookingSource,
      customerId: review.customerId,
    });
    if (userId === null) {
      ReplyPushHandler.log.log(`reply push for review ${reviewId} skipped: no push user for this customer`);
      return;
    }

    const salon = review.invite.salonName?.trim() || 'The salon';
    const outcome = await this.push.send({
      userId,
      eventId: replyPushEventId(reviewId),
      title: 'The salon replied',
      body: `${salon} replied to your review.`,
      data: { type: 'review_reply', reviewId, storefrontId: review.storefrontId },
    });
    if (outcome.kind === 'retry') throw new Error(outcome.error);
    if (outcome.kind === 'failed') {
      // A request the push service refuses will be refused again: stop here.
      ReplyPushHandler.log.error(`reply push for review ${reviewId} refused: ${outcome.error}`);
      return;
    }
    ReplyPushHandler.log.log(`reply push for review ${reviewId}: ${outcome.kind}`);
  }
}
