import { InviteLocale } from '../ports/invite-sender.port';

// ──────────────────────────────────────────────────────────────────────
// What the invite actually says.
//
// Pure. In the domain rather than the adapter so the copy is testable without
// a transport, and so swapping WhatsApp for anything else does not rewrite the
// words.
// ──────────────────────────────────────────────────────────────────────

/**
 * Which language to send in.
 *
 * THE TENANT'S DEFAULT, resolved from Tenant.localeDefault. The storefront
 * itself has no language column — checked — so "the storefront's language" is
 * the tenant's, one level up, and it always exists because the column is NOT
 * NULL with a default.
 *
 * NOT the customer's preferredLanguage, which exists on Customer but may be
 * absent for the very bookings most likely to need an invite. A field that is
 * sometimes there is a worse anchor than one that always is. Worth revisiting
 * once customers are reliably attached to bookings — see the ticket note.
 *
 * Anything that is not recognisably Arabic falls to English, because a wrong
 * guess in English is readable and a wrong guess in Arabic is not.
 */
export function inviteLocaleFrom(tenantLocale: string | null | undefined): InviteLocale {
  return (tenantLocale ?? '').trim().toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

/**
 * Build the review-invite link.
 *
 * THE TOKEN IS THE ONLY THING IN IT. No booking id, no customer id, no tenant —
 * anything else in the URL would be a second identifier to leak and a second
 * thing to validate. The token resolves to exactly one booking server-side.
 */
export function buildInviteUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${token}`;
}

export interface InviteCopy {
  salonName: string;
  displayName: string | null;
  url: string;
}

/**
 * The message body, in one of two languages.
 *
 * A NAMELESS GREETING IS A COMPLETE SENTENCE, not a greeting with a hole in it.
 * A walk-in has no name on file, and "Hi ," is worse than "Hi".
 *
 * The salon's name is included because the customer is being messaged days
 * after the appointment by a number they do not recognise; without it this
 * reads like spam, which is exactly what it will be reported as.
 */
export function renderInviteMessage(locale: InviteLocale, copy: InviteCopy): string {
  const name = copy.displayName?.trim() || null;
  if (locale === 'ar') {
    const greeting = name ? `مرحبًا ${name}،` : 'مرحبًا،';
    return [
      greeting,
      `شكرًا لزيارتك ${copy.salonName}.`,
      'هل يمكنك تقييم زيارتك؟ الأمر يستغرق أقل من دقيقة:',
      copy.url,
    ].join('\n');
  }
  const greeting = name ? `Hi ${name},` : 'Hi,';
  return [
    greeting,
    `thanks for visiting ${copy.salonName}.`,
    'Could you rate your visit? It takes less than a minute:',
    copy.url,
  ].join('\n');
}
