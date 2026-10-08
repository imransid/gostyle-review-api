import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { AppConfig, loadConfig } from './app-config';

/**
 * Loads `.env` (local development only; containers get real variables) and
 * provides one validated AppConfig to the whole app.
 *
 * The factory runs during bootstrap, so a missing variable stops the process
 * before it listens on a port, with every problem named in one message.
 */
@Global()
@Module({
  imports: [NestConfigModule.forRoot({ cache: true })],
  providers: [{ provide: AppConfig, useFactory: () => loadConfig(process.env) }],
  exports: [AppConfig],
})
export class ConfigModule {}
