import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { AppConfig } from '../../../shared/config/app-config';
import type { ReviewInvite } from '../../domain/invite/review-invite.aggregate';
import type { SendOutcome } from '../../domain/invite/invite-send';
import { CONTACT_DIRECTORY, type ContactDirectory } from '../../domain/ports/contact-directory.port';
import { INVITE_SENDER, type InviteSender } from '../../domain/ports/invite-sender.port';
import {
  REVIEW_INVITE_REPOSITORY,
  type ReviewInviteRepository,
} from '../../domain/ports/review-invite.repository';
import {
  buildInviteUrl,
  inviteLocaleFrom,
  renderInviteMessage,
} from '../../domain/services/review-invite-message';
import type { InviteToken } from '../../domain/value-objects/invite-token';
import { CLOCK, type Clock } from '../clock';
import { INVITE_RESEND_JOB, JOBS_QUEUE } from '../jobs/queues';

/** 1 min, 2, 4, 8, 16 ... between resend attempts, capped at an hour. */
export function resendDelayMs(attemptsSoFar: number): number {
  return Math.min(60_000 * 2 ** Math.max(attemptsSoFar - 1, 0), 3_600_000);
}

/**
 * Sends an invite that was just minted (or just re-minted for a retry). The
 * LAST step: the invite row is already committed when this runs.
 *
 *   - the PHONE is read now, never stored (a number from three weeks ago may
 *     have changed); no phone means NO_CONTACT, which is not an error;
 *   - the link carries the token and nothing else;
 *   - what happened is recorded on the invite (send_status);
 *   - a send that DEFINITELY failed schedules a resend job carrying only the
 *     invite id: the resend mints a fresh token, because this one is gone;
 *   - nothing here ever logs or stores the token, the phone or the body.
 */
@Injectable()
export class InviteDelivery {
  private static readonly log = new Logger(InviteDelivery.name);

  constructor(
    @Inject(CONTACT_DIRECTORY) private readonly contacts: ContactDirectory,
    @Inject(INVITE_SENDER) private readonly sender: InviteSender,
    @Inject(REVIEW_INVITE_REPOSITORY) private readonly invites: ReviewInviteRepository,
    @InjectQueue(JOBS_QUEUE) private readonly jobs: Queue,
    private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async deliver(invite: ReviewInvite, token: InviteToken): Promise<ReviewInvite['sendStatus']> {
    const booking = `${invite.booking.source}/${invite.booking.id}`;
    let outcome: SendOutcome | { kind: 'no_contact' };
    try {
      const contact = await this.contacts.find({
        bookingSource: invite.booking.source,
        customerId: invite.customerId,
      });
      if (!contact?.phone) {
        outcome = { kind: 'no_contact' };
      } else {
        const locale = inviteLocaleFrom(invite.locale);
        const url = buildInviteUrl(this.config.reviewPublicBaseUrl, token.reveal());
        const copy = { salonName: invite.salonName ?? '', displayName: contact.displayName, url };
        outcome = await this.sender.send({
          phone: contact.phone,
          locale,
          body: renderInviteMessage(locale, copy),
          ...copy,
        });
      }
    } catch (e) {
      // The contact lookup failed: nothing was sent, so this is a retry.
      outcome = { kind: 'retry', error: e instanceof Error ? e.message : String(e) };
    }

    const now = this.clock.now();
    const retriesLeft = invite.sendAttempts < this.config.inviteSendRetryAttempts;
    invite.recordSend(outcome, now, retriesLeft);
    await this.invites.saveSendState(invite);

    if (invite.sendStatus === 'RETRYING') {
      await this.jobs.add(
        INVITE_RESEND_JOB,
        { inviteId: invite.id },
        {
          // One job per attempt: a duplicate add for the same attempt is a no-op.
          jobId: `invite-resend-${invite.id}-${invite.sendAttempts}`,
          delay: resendDelayMs(invite.sendAttempts),
          removeOnComplete: true,
          removeOnFail: 50,
        },
      );
    }
    // The booking, never the token, the phone or the body.
    InviteDelivery.log.log(
      `invite for booking ${booking}: ${invite.sendStatus}` +
        (invite.lastSendError && invite.sendStatus !== 'SENT' ? ` (${invite.lastSendError})` : ''),
    );
    return invite.sendStatus;
  }

  /**
   * The resend job. The old token reached nobody (the send DEFINITELY
   * failed), so a fresh one is minted for the SAME invite, swapped in under a
   * compare-and-set, and sent. A SENT, used or expired invite is left alone.
   */
  async resend(inviteId: string): Promise<ReviewInvite['sendStatus'] | 'skipped'> {
    const invite = await this.invites.findById(inviteId);
    if (!invite) return 'skipped';
    const token = invite.rotateForRetry(this.clock.now());
    if (!token) return 'skipped';
    if (!(await this.invites.saveRotatedToken(invite))) return 'skipped';
    return this.deliver(invite, token);
  }
}
