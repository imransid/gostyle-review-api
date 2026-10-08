import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../../../shared/config/app-config';
import type { SendOutcome } from '../../domain/invite/invite-send';
import type { InviteMessage, InviteSender } from '../../domain/ports/invite-sender.port';
import { maskPhone } from './mask-phone';

const TIMEOUT_MS = 10_000;

/**
 * The invite over the WhatsApp Cloud API.
 *
 * Ported from the platform's WhatsAppReviewInviteSender (a thin adapter over
 * one transport). The platform's transport has no provider yet and only logs;
 * the Cloud API call itself follows customer-api's OTP sender
 * (apps/accounts/notifications.py), the one live WhatsApp integration in the
 * estate.
 *
 * A review invite lands days after the visit, outside WhatsApp's 24-hour
 * window, so it MUST be a pre-approved template, one per language:
 *   body parameters  {{1}} the customer's name (or empty), {{2}} the salon
 *   URL button       the dynamic suffix is the token: the template's base URL
 *                    is REVIEW_PUBLIC_BASE_URL
 *
 * NEVER THROWS. It classifies, because the caller's next move depends on it:
 *   2xx                         sent
 *   429, 5xx, refused/DNS       retry  (it definitely did not land)
 *   other 4xx                   failed (bad number or template; retrying won't help)
 *   timeout after sending       unknown (it may have landed: never retried)
 */
@Injectable()
export class WhatsAppInviteSender implements InviteSender {
  private static readonly log = new Logger(WhatsAppInviteSender.name);

  constructor(private readonly config: AppConfig) {}

  async send(m: InviteMessage): Promise<SendOutcome> {
    const wa = this.config.whatsapp!;
    const suffix = m.url.slice(this.config.reviewPublicBaseUrl.length + 1);
    const payload = {
      messaging_product: 'whatsapp',
      to: m.phone.replace(/^\+/, ''),
      type: 'template',
      template: {
        name: m.locale === 'ar' ? wa.templateAr : wa.templateEn,
        language: { code: m.locale },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: m.displayName ?? '' },
              { type: 'text', text: m.salonName },
            ],
          },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: suffix }] },
        ],
      },
    };

    let res: Response;
    try {
      res = await fetch(`https://graph.facebook.com/${wa.apiVersion}/${wa.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { authorization: `Bearer ${wa.accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      const name = e instanceof Error ? e.name : 'Error';
      // A timeout means the request may have been accepted: do not resend.
      if (name === 'TimeoutError' || name === 'AbortError') {
        return { kind: 'unknown', error: `WhatsApp timed out after ${TIMEOUT_MS}ms` };
      }
      return { kind: 'retry', error: `WhatsApp unreachable (${name})` };
    }

    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[] };
      return { kind: 'sent', ref: body.messages?.[0]?.id ?? null };
    }
    // The provider's error text can echo the request; keep only the status.
    if (res.status === 429 || res.status >= 500) return { kind: 'retry', error: `WhatsApp HTTP ${res.status}` };
    WhatsAppInviteSender.log.error(`WhatsApp refused the invite to ${maskPhone(m.phone)}: HTTP ${res.status}`);
    return { kind: 'failed', error: `WhatsApp HTTP ${res.status}` };
  }
}
