export class ListReportQueueQuery {
  constructor(public readonly input: { status?: string; offset?: number; limit?: number }) {}
}

export class GetReportQuery {
  constructor(public readonly reportId: string) {}
}
