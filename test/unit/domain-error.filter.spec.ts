import { ConflictException, ForbiddenException, HttpException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { describe, expect, it, vi } from 'vitest';
import { DomainError, DOMAIN_ERROR_CODES } from '../../src/review/domain/domain.error';
import {
  DomainErrorFilter,
  STATUS_BY_CODE,
  toEnvelope,
} from '../../src/shared/http/domain-error.filter';

describe('toEnvelope', () => {
  it.each([
    ['INVITE_NOT_FOUND', 404],
    ['INVITE_EXPIRED', 410],
    ['INVITE_ALREADY_USED', 409],
    ['VALIDATION_FAILED', 422],
  ] as const)('maps the refusal %s to %i', (code, status) => {
    const r = toEnvelope(new DomainError(code));
    expect(r.status).toBe(status);
    expect(r.body.error.code).toBe(code);
  });

  it('has a status for every domain code', () => {
    for (const code of DOMAIN_ERROR_CODES) {
      expect(STATUS_BY_CODE[code], code).toBeGreaterThanOrEqual(400);
    }
  });

  it('serves field details in the platform envelope', () => {
    const details = [{ field: 'rating', code: 'OUT_OF_RANGE', message: 'm' }];
    expect(toEnvelope(DomainError.validation(details)).body).toEqual({
      error: { code: 'VALIDATION_FAILED', message: 'One or more fields failed validation.', details },
    });
  });

  it('keeps a code a Nest exception was thrown with', () => {
    const r = toEnvelope(new ForbiddenException({ code: 'PERMISSION_DENIED', message: 'no' }));
    expect(r).toEqual({
      status: 403,
      body: { error: { code: 'PERMISSION_DENIED', message: 'no', details: [] } },
    });
  });

  it('names an uncoded Nest exception by its status', () => {
    expect(toEnvelope(new ConflictException()).body.error.code).toBe('CONFLICT');
    expect(toEnvelope(new ThrottlerException()).status).toBe(429);
    expect(toEnvelope(new ThrottlerException()).body.error.code).toBe('RATE_LIMITED');
    expect(toEnvelope(new HttpException('teapot', 418)).body.error.code).toBe('ERROR');
  });

  it('hides an unexpected error behind a 500 with no internals', () => {
    const r = toEnvelope(new Error('connection to 10.0.0.5 refused for user review'));
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain('10.0.0.5');
  });
});

describe('DomainErrorFilter', () => {
  it('logs a 500 with the ROUTE PATTERN, never the URL that carries the token', () => {
    const filter = new DomainErrorFilter();
    const json = vi.fn();
    const res = { status: vi.fn(() => ({ json })) };
    const req = {
      method: 'POST',
      url: '/v1/public/reviews/SECRET-TOKEN',
      route: { path: '/v1/public/reviews/:token' },
    };
    const log = vi.spyOn((DomainErrorFilter as any).log, 'error').mockImplementation(() => {});
    const host = {
      switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
    } as any;

    filter.catch(new Error('boom'), host);

    expect(res.status).toHaveBeenCalledWith(500);
    const line = String(log.mock.calls[0][0]);
    expect(line).toContain('/v1/public/reviews/:token');
    expect(line).not.toContain('SECRET-TOKEN');
  });
});
