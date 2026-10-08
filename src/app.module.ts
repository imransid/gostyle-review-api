import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AppConfig } from './shared/config/app-config';
import { ConfigModule } from './shared/config/config.module';
import { HealthController } from './shared/http/health.controller';
import { loggerParams } from './shared/logging/logging';
import { PrismaModule } from './shared/prisma/prisma.module';
import { RedisModule, redisConnection } from './shared/redis/redis';
import { ReviewModule } from './review/review.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({ inject: [AppConfig], useFactory: loggerParams }),
    PrismaModule,
    RedisModule,
    BullModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        connection: redisConnection(config),
        prefix: config.queuePrefix,
        // Retries are explicit per job; nothing is retried by accident.
        defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: 100 },
      }),
    }),
    // Named throttlers, applied only where a route asks for them (the public
    // submit). In memory, per replica: exact with the one replica the stack
    // runs (docs/DECISIONS.md).
    ThrottlerModule.forRoot({
      throttlers: [
        { name: 'public-review-ip-hour', ttl: 3_600_000, limit: 10 },
        { name: 'public-review-ip-day', ttl: 86_400_000, limit: 40 },
      ],
    }),
    ReviewModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
