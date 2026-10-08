export class ListConsoleReviewsQuery {
  constructor(
    public readonly input: {
      tenantId: string;
      branchId: string;
      offset?: number;
      limit?: number;
      state?: string;
    },
  ) {}
}
