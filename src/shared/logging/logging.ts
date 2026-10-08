import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { AppConfig } from '../config/app-config';

/**
 * THE INVITE TOKEN IS IN THE PATH of two public routes, and pino-http logs
 * `req.url` by default. A token in a log line is a token in a log aggregator,
 * which is the one place it must never be. Every URL that reaches a log goes
 * through this first.
 */
const TOKEN_IN_PATH = /(\/v1\/public\/(?:reviews|review-invites)\/)[^/?#]+/g;

export function redactUrl(url: string | undefined): string | undefined {
  return url?.replace(TOKEN_IN_PATH, '$1[token]');
}

/** Pretty lines for a developer's terminal; JSON everywhere else (and in containers). */
function prettyAvailable(config: AppConfig): boolean {
  if (config.nodeEnv !== 'development' || !process.stdout.isTTY) return false;
  try {
    require.resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/** Reuse a caller's x-request-id when it is sane, otherwise mint one. */
export function requestIdFor(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers['x-request-id'];
  const id =
    typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', id);
  return id;
}

/** pino JSON logs with a request id on every line, as booking-api intends. */
export function loggerParams(config: AppConfig): Params {
  return {
    pinoHttp: {
      level: config.logLevel,
      genReqId: requestIdFor,
      // Health probes every few seconds would bury everything else.
      autoLogging: { ignore: (req) => req.url === '/health' },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-service-key"]',
          'req.headers["x-api-key"]',
        ],
        censor: '[redacted]',
      },
      serializers: {
        req: (req: { id: string; method: string; url: string; remoteAddress?: string }) => ({
          id: req.id,
          method: req.method,
          url: redactUrl(req.url),
          remoteAddress: req.remoteAddress,
        }),
      },
      transport: prettyAvailable(config)
        ? { target: 'pino-pretty', options: { singleLine: true } }
        : undefined,
    },
  };
}
