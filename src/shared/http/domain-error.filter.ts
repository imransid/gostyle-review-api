import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  DomainError,
  type DomainErrorCode,
  type DomainErrorDetail,
} from '../../review/domain/domain.error';
import { DependencyUnavailableError } from '../../review/domain/ports/contact-directory.port';

/**
 * THE ONE PLACE a domain error code becomes an HTTP status.
 *
 * Typed as a Record over every code, so adding a code without deciding its
 * status does not compile.
 */
export const STATUS_BY_CODE: Record<DomainErrorCode, number> = {
  INVITE_NOT_FOUND: 404,
  // 410 rather than 404: the link WAS real, the customer did not imagine it.
  INVITE_EXPIRED: 410,
  INVITE_ALREADY_USED: 409,
  VALIDATION_FAILED: 422,
  REVIEW_NOT_FOUND: 404,
  REVIEW_TRANSITION_INVALID: 409,
  REPLY_NOT_FOUND: 404,
  REPLY_ALREADY_EXISTS: 409,
  REPORT_NOT_FOUND: 404,
  REPORT_ALREADY_OPEN: 409,
  REPORT_TRANSITION_INVALID: 409,
};

const CODE_BY_STATUS: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  410: 'GONE',
  413: 'PAYLOAD_TOO_LARGE',
  422: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};

/**
 * The envelope gostyle-api's AllExceptionsFilter serves, so a console that
 * moves its base URL here reads errors with the code it already has:
 * `{ error: { code, message, details } }`.
 */
export interface ErrorEnvelope {
  error: { code: string; message: string; details: DomainErrorDetail[] };
}

export function toEnvelope(exception: unknown): { status: number; body: ErrorEnvelope } {
  if (exception instanceof DomainError) {
    return {
      status: STATUS_BY_CODE[exception.code] ?? HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        error: { code: exception.code, message: exception.message, details: exception.details },
      },
    };
  }

  // Our fault, not the caller's: the owner of a fact we needed did not answer.
  // A 503 tells the caller to retry; it is never answered with a guess.
  if (exception instanceof DependencyUnavailableError) {
    return {
      status: HttpStatus.SERVICE_UNAVAILABLE,
      body: {
        error: {
          code: 'DEPENDENCY_UNAVAILABLE',
          message: `${exception.dependency} is unavailable; try again shortly.`,
          details: [],
        },
      },
    };
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const response = exception.getResponse();
    const payload =
      typeof response === 'object' && response !== null
        ? (response as Record<string, unknown>)
        : { message: response };
    const code =
      typeof payload.code === 'string' ? payload.code : (CODE_BY_STATUS[status] ?? 'ERROR');
    const rawMessage = payload.message;
    const message =
      typeof rawMessage === 'string'
        ? rawMessage
        : Array.isArray(rawMessage)
          ? rawMessage.join('; ')
          : exception.message;
    const details = Array.isArray(payload.details) ? (payload.details as DomainErrorDetail[]) : [];
    return { status, body: { error: { code, message, details } } };
  }

  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    body: {
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.', details: [] },
    },
  };
}

/**
 * Catches everything, so every refusal leaves with a machine-readable code and
 * no handler or controller maps errors itself.
 *
 * Unexpected errors are logged with the ROUTE PATTERN, never the raw URL: the
 * public routes carry the invite token in the path.
 */
@Catch()
export class DomainErrorFilter implements ExceptionFilter {
  private static readonly log = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const { status, body } = toEnvelope(exception);

    if (status >= 500) {
      const route = (req.route as { path?: string } | undefined)?.path ?? '(unmatched route)';
      DomainErrorFilter.log.error(
        `${req.method} ${route} failed: ${exception instanceof Error ? exception.stack : String(exception)}`,
      );
    }

    res.status(status).json(body);
  }
}
