import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import IORedis from 'ioredis';
import { AppConfig } from '../config/app-config';

/** Connection options BullMQ and the health check share. */
export function redisConnection(config: AppConfig) {
  return {
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    // BullMQ requires this for its blocking commands.
    maxRetriesPerRequest: null,
  };
}

export const REDIS = Symbol('REDIS');

/** A plain client for /health. BullMQ keeps its own connections. */
@Injectable()
export class RedisHealth implements OnModuleInit, OnModuleDestroy {
  private static readonly log = new Logger(RedisHealth.name);

  constructor(@Inject(REDIS) private readonly redis: IORedis) {}

  /** Connect in the background: a Redis outage is a red /health, not a stuck boot. */
  onModuleInit(): void {
    this.redis.connect().catch((e: unknown) => {
      RedisHealth.log.error(`redis connect failed: ${e instanceof Error ? e.message : String(e)}`);
    });
  }

  async ping(): Promise<number> {
    const started = performance.now();
    await this.redis.ping();
    return Math.round((performance.now() - started) * 100) / 100;
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.quit();
    } catch (e) {
      RedisHealth.log.warn(`redis quit failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [AppConfig],
      // lazyConnect plus a short retry so a Redis outage shows up as a red
      // /health rather than a boot that hangs.
      useFactory: (config: AppConfig) =>
        new IORedis({
          ...redisConnection(config),
          maxRetriesPerRequest: 1,
          lazyConnect: true,
          enableOfflineQueue: false,
          connectTimeout: 2_000,
        }),
    },
    RedisHealth,
  ],
  exports: [REDIS, RedisHealth],
})
export class RedisModule {}
