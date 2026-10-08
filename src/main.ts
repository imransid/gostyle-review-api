import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AppConfig } from './shared/config/app-config';
import { DomainErrorFilter } from './shared/http/domain-error.filter';
import { edgeValidationPipe } from './shared/http/validation';

async function bootstrap(): Promise<void> {
  // bufferLogs: boot lines wait for pino instead of going out as plain text.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.disable('x-powered-by');

  const config = app.get(AppConfig);

  // The throttle keys on the client IP. Trusting X-Forwarded-For from a
  // client that talks to us directly would let it pick its own IP.
  app.set('trust proxy', config.trustProxyHops);

  app.useGlobalPipes(edgeValidationPipe());
  app.useGlobalFilters(new DomainErrorFilter());
  app.enableShutdownHooks();

  if (!config.isProduction) {
    const doc = new DocumentBuilder()
      .setTitle('Review Service')
      .setDescription(
        'Ratings and reviews for GoStyle salons. A review is written only by redeeming a ' +
          'single-use invite minted for a completed booking.',
      )
      .setVersion('0.1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'platform-jwt')
      .addApiKey({ type: 'apiKey', name: 'x-service-key', in: 'header' }, 'service-key')
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, doc), {
      jsonDocumentUrl: 'docs-json',
      swaggerOptions: { persistAuthorization: true },
    });
  }

  await app.listen(config.port);
}
void bootstrap();
