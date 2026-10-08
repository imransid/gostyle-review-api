export class SubmitReviewCommand {
  constructor(
    public readonly input: {
      /** The PLAINTEXT token from the link. Hashed before any lookup; never logged. */
      token: string;
      rating: unknown;
      comment?: unknown;
      language: unknown;
      /** Used only when the booking had no name on file. */
      authorDisplayName?: unknown;
    },
  ) {}
}
