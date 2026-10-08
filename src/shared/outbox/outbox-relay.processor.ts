import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { AppConfig } from '../config/app-config';
import { OutboxRelay } from './outbox-relay';

export const OUTBOX_QUEUE = 'review-outbox';
const SCHEDULER_ID = 'outbox-relay';

/**
 * The relay as a BullMQ repeatable job. Concurrency 1 per replica; across
 * replicas, the relay's SKIP LOCKED claim keeps batches disjoint.
 *
 * The job carries NO payload: it is a clock tick. Events stay in Postgres,
 * where they were committed with the change, until delivered.
 */
@Processor(OUTBOX_QUEUE, { concurrency: 1 })
export class OutboxRelayProcessor extends WorkerHost {
  constructor(private readonly relay: OutboxRelay) {
    super();
  }

  async process(_job: Job): Promise<void> {
    await this.relay.tick();
  }
}

@Injectable()
export class OutboxRelayScheduler implements OnApplicationBootstrap {
  private static readonly log = new Logger(OutboxRelayScheduler.name);

  constructor(
    @InjectQueue(OUTBOX_QUEUE) private readonly queue: Queue,
    private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Upsert, so a restart or a second replica does not stack schedules.
    await this.queue.upsertJobScheduler(
      SCHEDULER_ID,
      { every: this.config.outboxRelayIntervalMs },
      { name: 'drain', opts: { removeOnComplete: true, removeOnFail: 50 } },
    );
    OutboxRelayScheduler.log.log(`outbox relay every ${this.config.outboxRelayIntervalMs}ms`);
  }
}
