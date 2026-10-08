export class ListPublicReviewsQuery {
  constructor(
    public readonly input: { storefrontId: string; offset?: number; limit?: number; language?: string },
  ) {}
}
