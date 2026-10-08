export class EraseCustomerReviewsCommand {
  constructor(
    public readonly input: {
      customerId: string;
      /** Platform customer ids are per salon; scope to it when known. */
      tenantId: string | null;
      inbox?: { source: string; eventId: string; eventType: string };
    },
  ) {}
}
