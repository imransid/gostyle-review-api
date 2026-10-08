import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
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
        // Retries are explicit per job; nothing is retried by accident.
        defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: 100 },
      }),
    }),
    ReviewModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
