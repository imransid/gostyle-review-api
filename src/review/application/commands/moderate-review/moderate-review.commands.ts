interface ModerateInput {
  reviewId: string;
  moderatorId: string;
  note: unknown;
}

export class HideReviewCommand {
  constructor(public readonly input: ModerateInput) {}
}

export class RestoreReviewCommand {
  constructor(public readonly input: ModerateInput) {}
}

/** Final: a removed review never comes back. */
export class RemoveReviewCommand {
  constructor(public readonly input: ModerateInput) {}
}
