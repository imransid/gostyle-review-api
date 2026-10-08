import type { Logger } from '@nestjs/common';

/**
 * Run `work` now; if it fails, log it and try again in the background with
 * backoff (2 s, 4 s ... capped at a minute) until it succeeds or `stop()`.
 *
 * For start-up registrations against Redis (BullMQ job schedulers). Without
 * this, a Redis outage at boot made `upsertJobScheduler` throw inside
 * onApplicationBootstrap and the whole process died; now the app comes up,
 * /health reports Redis down, and the schedules register once Redis returns.
 */
export function retryUntilDone(
  name: string,
  work: () => Promise<void>,
  log: Pick<Logger, 'error' | 'log'>,
): { stop: () => void; done: Promise<void> } {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let resolveDone!: () => void;
  const done = new Promise<void>((r) => (resolveDone = r));

  const attempt = async (n: number): Promise<void> => {
    if (stopped) return resolveDone();
    try {
      await work();
      if (n > 1) log.log(`${name}: registered after ${n} attempts`);
      resolveDone();
    } catch (e) {
      if (n === 1 || n % 10 === 0) {
        log.error(`${name} failed (attempt ${n}), retrying: ${e instanceof Error ? e.message : String(e)}`);
      }
      const delay = Math.min(2_000 * 2 ** (n - 1), 60_000);
      timer = setTimeout(() => void attempt(n + 1), delay);
      timer.unref();
    }
  };
  void attempt(1);

  return {
    done,
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      resolveDone();
    },
  };
}
