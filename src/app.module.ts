import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AppConfig } from './shared/config/app-config';
import { ConfigModule } from './shared/config/config.module';
import { HealthController } from './shared/http/health.controller';
import { loggerParams } from './shared/logging/logging';
import { PrismaModule } from './shared/prisma/prisma.module';
import { RedisModule } from './shared/redis/redis';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({ inject: [AppConfig], useFactory: loggerParams }),
    PrismaModule,
    RedisModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
