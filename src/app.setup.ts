import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppConfig } from './shared/config/app-config';
import { DomainErrorFilter } from './shared/http/domain-error.filter';
import { edgeValidationPipe } from './shared/http/validation';

/**
 * Everything main.ts does to the app before it listens, in one place, so the
 * e2e specs boot exactly what production boots.
 */
export function configureApp(app: NestExpressApplication): AppConfig {
  const log = app.get(Logger);
  app.useLogger(log);
  app.disable('x-powered-by');
  const config = app.get(AppConfig);

  // The throttle keys on the client IP. Trusting X-Forwarded-For from a
  // client that talks to us directly would let it pick its own IP.
  app.set('trust proxy', config.trustProxyHops);

  app.useGlobalPipes(edgeValidationPipe());
  app.useGlobalFilters(new DomainErrorFilter());
  app.enableShutdownHooks();

  // Production serves the docs only when SWAGGER_ENABLED=true says so, for a
  // testing window, without touching NODE_ENV (docs/DECISIONS.md D27).
  if (!config.isProduction || config.swaggerEnabled) {
    if (config.isProduction) {
      log.warn(
        'Swagger is ON in production (SWAGGER_ENABLED=true); turn it off after testing',
        'Swagger',
      );
    }
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
  return config;
}
