import type { SendOutcome } from '../invite/invite-send';

/** The two languages a storefront speaks. Mirrors ReviewLanguage, lowercased. */
export type InviteLocale = 'en' | 'ar';

export const INVITE_SENDER = Symbol('INVITE_SENDER');

export interface InviteMessage {
  /** As the contact directory returned it, read at send time, never stored. */
  phone: string;
  locale: InviteLocale;
  /** The rendered text (renderInviteMessage). Contains the link, so it is never logged. */
  body: string;
  /** The parts a template-based channel fills in, in place of the body. */
  salonName: string;
  displayName: string | null;
  url: string;
}

/**
 * Deliver an invite. A pure transport: the words are composed in the domain.
 *
 * NEVER THROWS. It classifies what happened (see SendOutcome) so the caller
 * can decide between "done", "retry with a fresh token" and "never retry".
 */
export interface InviteSender {
  send(message: InviteMessage): Promise<SendOutcome>;
}
