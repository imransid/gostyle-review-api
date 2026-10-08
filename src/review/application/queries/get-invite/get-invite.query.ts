export class GetInviteQuery {
  /** The PLAINTEXT token from the link; hashed before the lookup. */
  constructor(public readonly token: string) {}
}
