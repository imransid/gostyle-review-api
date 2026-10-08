/**
 * Where an invite's message stands. The token is never stored, so "resend the
 * same link" does not exist: a retry mints a new token for the same invite.
 */
export const INVITE_SEND_STATUSES = [
  'PENDING',
  'SENT',
  'RETRYING',
  'UNKNOWN',
  'FAILED',
  'NO_CONTACT',
] as const;
export type InviteSendStatus = (typeof INVITE_SEND_STATUSES)[number];

/**
 * What one send attempt achieved, as the sender classifies it.
 *
 *   sent      the channel accepted it                  -> SENT, never again
 *   retry     it DEFINITELY did not land (refused connection, 5xx, 429)
 *   failed    it never will (4xx: bad number, bad template)
 *   unknown   timed out after the request left: it may have landed, so it is
 *             NEVER retried. A second message would be worse than none.
 */
export type SendOutcome =
  | { kind: 'sent'; ref: string | null }
  | { kind: 'retry'; error: string }
  | { kind: 'failed'; error: string }
  | { kind: 'unknown'; error: string };
