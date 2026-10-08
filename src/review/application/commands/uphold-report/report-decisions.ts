export class UpholdReportCommand {
  constructor(public readonly input: { reportId: string; reviewerId: string; note: unknown }) {}
}

export class DismissReportCommand {
  constructor(public readonly input: { reportId: string; reviewerId: string; note: unknown }) {}
}
