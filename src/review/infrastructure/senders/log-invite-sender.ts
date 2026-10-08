import { Injectable, Logger } from '@nestjs/common';
import type { SendOutcome } from '../../domain/invite/invite-send';
import type { InviteMessage, InviteSender } from '../../domain/ports/invite-sender.port';
import { maskPhone } from './mask-phone';

/**
 * Development sender: says what WOULD be sent, and sends nothing.
 *
 * NOT the body and never the URL: the body contains the token, and a token in
 * a log line is a token in a log aggregator. A masked number and a length are
 * evidence that a message was composed, and nothing more. (Same rule as the
 * platform's WhatsAppService fallback.)
 */
@Injectable()
export class LogInviteSender implements InviteSender {
  private static readonly log = new Logger('InviteSender');

  async send(m: InviteMessage): Promise<SendOutcome> {
    LogInviteSender.log.log(
      `INVITE_SENDER=log: review invite to ${maskPhone(m.phone)} not sent (${m.locale}, ${m.body.length} chars)`,
    );
    return { kind: 'sent', ref: 'log' };
  }
}
