import { createHash, randomBytes } from 'node:crypto';

// ──────────────────────────────────────────────────────────────────────
// The invite token: the only way in.
//
// A review cannot be written without one of these, which is what makes
// "verified booking only" true rather than aspirational. The token IS the
// authorization subject — there is no customer principal to authenticate, and
// no session behind the write.
//
// Pure apart from node:crypto, which is deterministic given its input and
// carries no I/O. Same split the staff invitation token already makes.
// ──────────────────────────────────────────────────────────────────────

/**
 * How long a review invite stays writable.
 *
 * THIRTY DAYS, and the number is a judgement rather than a constraint: long
 * enough that a customer who ignores the message on the day can still act on it
 * a fortnight later, short enough that a leaked link from last year is inert.
 * The expiry is what bounds the blast radius of a token that escapes, since
 * there is nothing else behind it.
 */
export const INVITE_TTL_DAYS = 30;

/**
 * Bytes of entropy in the token.
 *
 * 32, matching the staff invitation. base64url of 32 random bytes is 43
 * characters with no padding and nothing to escape in a URL or a WhatsApp
 * message, which is where this is going to live.
 */
const TOKEN_BYTES = 32;

/**
 * Mint a token and its hash.
 *
 * THE PLAINTEXT IS RETURNED ONCE AND NEVER STORED. Only the hash goes in the
 * row, so a database leak does not hand anyone the ability to write reviews —
 * the same reason the staff invitation stores a hash, and the reason there is
 * no "resend the same link" path: a lost token is re-minted, never recovered.
 */
export function mintInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashInviteToken(token) };
}

/**
 * Hash a token for lookup.
 *
 * Plain SHA-256, not a password KDF, and that is correct here: the input is 256
 * bits of machine-generated entropy, so there is no dictionary to attack and
 * nothing a slow hash would buy. The staff invitation makes the same call.
 */
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** When an invite minted now stops being writable. */
export function inviteExpiryFrom(now: Date): Date {
  return new Date(now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/** Why an invite cannot be used. Null means it can. */
export type InviteRefusal = 'INVITE_NOT_FOUND' | 'INVITE_EXPIRED' | 'INVITE_ALREADY_USED';

export interface InviteState {
  expiresAt: Date;
  usedAt: Date | null;
}

/**
 * Whether an invite may be redeemed, and if not, precisely why.
 *
 * RESOLVED BEFORE ANYTHING IS WRITTEN, so the caller can answer with the real
 * reason rather than a generic failure — "this link has already been used" and
 * "this link expired" send a customer to different places. Order matters: a
 * used invite reports as used even after it has also expired, because that is
 * the more informative of the two and the one that is not going to change.
 *
 * NOT the last word on single use. Two concurrent redemptions both pass this,
 * so the write settles it with a conditional update and the review's unique
 * constraint backstops that. This function exists for the MESSAGE, not the
 * guarantee.
 */
export function refuseInvite(invite: InviteState | null, now: Date): InviteRefusal | null {
  if (!invite) return 'INVITE_NOT_FOUND';
  if (invite.usedAt !== null) return 'INVITE_ALREADY_USED';
  if (invite.expiresAt.getTime() <= now.getTime()) return 'INVITE_EXPIRED';
  return null;
}
