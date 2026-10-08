import { Inject, Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { INBOX, type Inbox } from '../../../../shared/outbox/outbox.port';
import { DomainError } from '../../../domain/domain.error';
import {
  REVIEW_INVITE_REPOSITORY,
  type ReviewInviteRepository,
} from '../../../domain/ports/review-invite.repository';
import { REVIEW_REPOSITORY, type ReviewRepository } from '../../../domain/ports/review.repository';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../domain/ports/unit-of-work.port';
import { isUuid } from '../../../domain/shared/uuidv7';
import { EraseCustomerReviewsCommand } from './erase-customer-reviews.command';

export interface EraseResult {
  reviews: number;
  invites: number;
  duplicate: boolean;
}

/**
 * A customer was deleted: blank their name and customer id on every review
 * (and invite) they left. The words stay; the link to the person goes. The
 * rating summary is unaffected, so nothing is re-projected.
 */
@CommandHandler(EraseCustomerReviewsCommand)
export class EraseCustomerReviewsHandler
  implements ICommandHandler<EraseCustomerReviewsCommand, EraseResult>
{
  private static readonly log = new Logger(EraseCustomerReviewsHandler.name);

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(REVIEW_REPOSITORY) private readonly reviews: ReviewRepository,
    @Inject(REVIEW_INVITE_REPOSITORY) private readonly invites: ReviewInviteRepository,
    @Inject(INBOX) private readonly inbox: Inbox,
  ) {}

  async execute(cmd: EraseCustomerReviewsCommand): Promise<EraseResult> {
    const i = cmd.input;
    if (!isUuid(i.customerId)) {
      throw DomainError.validation([
        { field: 'customerId', code: 'INVALID_FORMAT', message: 'customerId must be a uuid.' },
      ]);
    }
    const result = await this.uow.run(async (tx) => {
      if (i.inbox) {
        const first = await this.inbox.record({ ...i.inbox, tenantId: i.tenantId }, tx);
        if (!first) return { reviews: 0, invites: 0, duplicate: true };
      }
      const reviews = await this.reviews.eraseCustomer(i.customerId, i.tenantId, tx);
      const invites = await this.invites.eraseCustomer(i.customerId, i.tenantId, tx);
      if (i.inbox) {
        await this.inbox.setOutcome(
          { source: i.inbox.source, eventId: i.inbox.eventId, outcome: 'erased', tenantId: i.tenantId },
          tx,
        );
      }
      return { reviews, invites, duplicate: false };
    });
    EraseCustomerReviewsHandler.log.log(
      `customer erased: ${result.reviews} review(s), ${result.invites} invite(s)`,
    );
    return result;
  }
}
