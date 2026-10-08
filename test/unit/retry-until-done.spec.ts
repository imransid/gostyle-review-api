import { afterEach, describe, expect, it, vi } from 'vitest';
import { retryUntilDone } from '../../src/shared/redis/retry-until-done';

afterEach(() => vi.useRealTimers());

describe('retryUntilDone', () => {
  it('runs once when the work succeeds', async () => {
    const work = vi.fn(async () => {});
    const log = { error: vi.fn(), log: vi.fn() };
    await retryUntilDone('x', work, log).done;
    expect(work).toHaveBeenCalledTimes(1);
    expect(log.error).not.toHaveBeenCalled();
  });

  it('does NOT throw when Redis is down: it logs and retries until it succeeds', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const work = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Error('Connection is closed.');
    });
    const log = { error: vi.fn(), log: vi.fn() };
    const r = retryUntilDone('outbox relay schedule', work, log);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(4_000);
    await r.done;
    expect(work).toHaveBeenCalledTimes(3);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.log).toHaveBeenCalledWith('outbox relay schedule: registered after 3 attempts');
  });

  it('stops retrying on shutdown', async () => {
    vi.useFakeTimers();
    const work = vi.fn(async () => {
      throw new Error('down');
    });
    const r = retryUntilDone('x', work, { error: vi.fn(), log: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    r.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(work).toHaveBeenCalledTimes(1);
  });
});
