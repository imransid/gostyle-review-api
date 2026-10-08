import type { SalonInput } from '../post-reply/reply-commands';

export class ReportReviewCommand {
  constructor(public readonly input: SalonInput & { reason: unknown; note?: unknown }) {}
}
