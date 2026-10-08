import { hashInviteToken, mintInviteToken } from '../services/review-invite-rules';

const REDACTED = '[invite-token]';

/**
 * The plaintext invite token, which exists ONLY between minting and sending.
 *
 * 32 random bytes, base64url (mintInviteToken). Only `hash` is ever stored.
 * The plaintext is reachable through reveal() and nothing else: toString,
 * toJSON and Node's inspect all print a placeholder, so a token that lands in
 * a log line, an event payload or an error message by accident prints as
 * "[invite-token]" instead of a working credential.
 */
export class InviteToken {
  readonly #plain: string;

  private constructor(
    plain: string,
    readonly hash: string,
  ) {
    this.#plain = plain;
  }

  static mint(): InviteToken {
    const { token, tokenHash } = mintInviteToken();
    return new InviteToken(token, tokenHash);
  }

  /** The hash to look a presented token up by. The token is not kept. */
  static hashOf(presented: string): string {
    return hashInviteToken(presented);
  }

  /** For building the link, at send time. The only way to the plaintext. */
  reveal(): string {
    return this.#plain;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return REDACTED;
  }
}
