export class RecomputeRatingSummariesCommand {
  constructor(public readonly input: { trigger: 'nightly' | 'manual' }) {}
}
