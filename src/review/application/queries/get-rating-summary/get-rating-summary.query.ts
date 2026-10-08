/** customer-api's backfill and repair: by ids, or every summary page by page. */
export class GetRatingSummariesQuery {
  constructor(
    public readonly input: { storefrontIds?: string[]; after?: string; limit?: number },
  ) {}
}

/** The salon console's own rating, found from the branch it is working in. */
export class GetConsoleAggregateQuery {
  constructor(public readonly input: { tenantId: string; branchId: string }) {}
}
