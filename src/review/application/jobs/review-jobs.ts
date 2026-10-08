import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import type { Job, Queue } from 'bullmq';
import { AppConfig } from '../../../shared/config/app-config';
import { RecomputeRatingSummariesCommand } from '../commands/recompute-rating-summaries/recompute-rating-summaries.command';

export const JOBS_QUEUE = 'review-jobs';
export const RECOMPUTE_JOB = 'recompute-summaries';

/**
 * Scheduled work, on BullMQ: retried with backoff (the push service's
 * settings: 3 attempts, exponential), and safe across replicas because a job
 * scheduler fires once per tick for the whole queue, not once per process.
 */
@Processor(JOBS_QUEUE, { concurrency: 1 })
export class ReviewJobsProcessor extends WorkerHost {
  private static readonly log = new Logger(ReviewJobsProcessor.name);

  constructor(private readonly commands: CommandBus) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case RECOMPUTE_JOB:
        return this.commands.execute(new RecomputeRatingSummariesCommand({ trigger: 'nightly' }));
      default:
        ReviewJobsProcessor.log.warn(`unknown job ${job.name}; ignored`);
        return undefined;
    }
  }
}

@Injectable()
export class ReviewJobsScheduler implements OnApplicationBootstrap {
  private static readonly log = new Logger(ReviewJobsScheduler.name);

  constructor(
    @InjectQueue(JOBS_QUEUE) private readonly queue: Queue,
    private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'nightly-recompute',
      { pattern: this.config.recomputeCron, tz: this.config.recomputeTimezone },
      {
        name: RECOMPUTE_JOB,
        opts: { attempts: 3, backoff: { type: 'exponential', delay: 60_000 }, removeOnComplete: 30, removeOnFail: 30 },
      },
    );
    // Retention is configuration only for now: NOTHING is scheduled to delete.
    ReviewJobsScheduler.log.log(
      `nightly recompute at "${this.config.recomputeCron}" ${this.config.recomputeTimezone}; ` +
        `retention configured (invites ${this.config.retention.expiredInviteDays}d, ` +
        `closed reports ${this.config.retention.closedReportDays}d) but not scheduled`,
    );
  }
}
