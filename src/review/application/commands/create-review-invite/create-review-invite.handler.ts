import { Inject, Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { INBOX, OUTBOX_WRITER, type Inbox, type OutboxWriter } from '../../../../shared/outbox/outbox.port';
import { ReviewInvite } from '../../../domain/invite/review-invite.aggregate';
import {
  REVIEW_INVITE_REPOSITORY,
  type ReviewInviteRepository,
} from '../../../domain/ports/review-invite.repository';
import {
  STOREFRONT_DIRECTORY,
  type StorefrontDirectory,
} from '../../../domain/ports/storefront-directory.port';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../domain/ports/unit-of-work.port';
import { BookingRef } from '../../../domain/value-objects/booking-ref';
import type { InviteToken } from '../../../domain/value-objects/invite-token';
import { SubjectRef } from '../../../domain/value-objects/subject-ref';
import { CLOCK, type Clock } from '../../clock';
import { recordEvents } from '../../record-events';
import { CreateReviewInviteCommand } from './create-review-invite.command';

export type CreateReviewInviteOutcome =
  | 'invite_minted'
  | 'already_invited'
  | 'duplicate_event'
  | 'no_storefront'
  | 'tenant_mismatch';

/**
 * What delivery needs. The token appears here, once, and is unrecoverable
 * after: only its hash was stored.
 */
export interface CreateReviewInviteResult {
  outcome: CreateReviewInviteOutcome;
  invite: ReviewInvite | null;
  token: InviteToken | null;
}

/**
 * Mint the one way in (the platform's CreateReviewInviteHandler).
 *
 * ONE INVITE PER BOOKING, FOREVER. A booking that already has one gets
 * `already_invited`, even if that invite is unused and long expired:
 * re-completing a booking is not a way to nudge a customer.
 *
 * MINT FIRST, SEND LAST. This only mints and commits. The caller sends after
 * the commit, so a failed send finds the invite already there, and a
 * redelivered event stops at `duplicate_event` / `already_invited` before
 * anything is sent twice.
 *
 * THE TENANT COMES FROM THE STOREFRONT'S OWNER, looked up by branch. An event
 * that names a different tenant is refused (tenant_mismatch), and nothing is
 * ever defaulted.
 */
@CommandHandler(CreateReviewInviteCommand)
export class CreateReviewInviteHandler
  implements ICommandHandler<CreateReviewInviteCommand, CreateReviewInviteResult>
{
  private static readonly log = new Logger(CreateReviewInviteHandler.name);

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(REVIEW_INVITE_REPOSITORY) private readonly invites: ReviewInviteRepository,
    @Inject(STOREFRONT_DIRECTORY) private readonly storefronts: StorefrontDirectory,
    @Inject(INBOX) private readonly inbox: Inbox,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(cmd: CreateReviewInviteCommand): Promise<CreateReviewInviteResult> {
    const i = cmd.input;
    const booking = BookingRef.of(i.bookingSource, i.bookingId);
    const now = this.clock.now();

    // ─── 1. Which storefront. A read, so it happens before anything is
    //        written: if the platform is down this throws, nothing commits,
    //        and the redelivery tries again.
    const storefront = await this.storefronts.findByBranch(i.branchId);

    let outcome: CreateReviewInviteOutcome;
    let minted: { invite: ReviewInvite; token: InviteToken } | null = null;
    if (!storefront) {
      // A branch with no storefront has no page to review. Ordinary.
      outcome = 'no_storefront';
    } else if (i.tenantId !== null && i.tenantId.toLowerCase() !== storefront.tenantId.toLowerCase()) {
      outcome = 'tenant_mismatch';
      CreateReviewInviteHandler.log.warn(
        `booking ${booking.source}/${booking.id}: event tenant does not own branch ${i.branchId}; no invite`,
      );
    } else {
      minted = ReviewInvite.mint({
        subject: SubjectRef.of({
          tenantId: storefront.tenantId,
          storefrontId: storefront.storefrontId,
          branchId: storefront.branchId,
        }),
        booking,
        customerId: i.customerId,
        display: {
          salonName: storefront.salonName,
          storefrontSlug: storefront.slug,
          locale: storefront.locale,
        },
        now,
      });
      outcome = 'invite_minted';
    }
    const tenantId = storefront?.tenantId ?? i.tenantId ?? null;

    // ─── 2. One transaction: inbox row FIRST, then the invite, then its event.
    const result = await this.uow.run(async (tx) => {
      if (i.inbox) {
        const first = await this.inbox.record({ ...i.inbox, tenantId }, tx);
        if (!first) return { outcome: 'duplicate_event' as const, invite: null, token: null };
      }
      let invite: ReviewInvite | null = null;
      let token: InviteToken | null = null;
      if (minted) {
        const created = await this.invites.insertIfAbsent(minted.invite, tx);
        if (created) {
          await recordEvents(this.outbox, tx, minted.invite);
          invite = minted.invite;
          token = minted.token;
        } else {
          outcome = 'already_invited';
        }
      }
      if (i.inbox) {
        await this.inbox.setOutcome(
          { source: i.inbox.source, eventId: i.inbox.eventId, outcome, tenantId },
          tx,
        );
      }
      return { outcome, invite, token };
    });

    // The booking, never the token.
    CreateReviewInviteHandler.log.log(`booking ${booking.source}/${booking.id}: ${result.outcome}`);
    return result;
  }
}
