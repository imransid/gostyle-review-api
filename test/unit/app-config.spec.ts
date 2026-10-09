import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/shared/config/app-config';

const base = (): Record<string, string> => ({
  NODE_ENV: 'development',
  PORT: '3352',
  DATABASE_URL: 'postgresql://review:pw@127.0.0.1:5435/review',
  REDIS_HOST: '127.0.0.1',
  REDIS_PORT: '6382',
  REDIS_PASSWORD: 'pw',
  JWT_ACCESS_SECRET: 'jwt',
  PLATFORM_API_URL: 'http://127.0.0.1:3000/',
  PLATFORM_INTERNAL_KEY: 'pik',
  SERVICE_KEY_PLATFORM: 'k-platform',
  SERVICE_KEY_BOOKING_API: 'k-booking',
  SERVICE_KEY_CUSTOMER_API: 'k-customer',
  SERVICE_KEY_OPS: 'k-ops',
  CUSTOMER_API_URL: 'http://127.0.0.1:8000',
  CUSTOMER_API_KEY: 'cak',
  PUSH_API_URL: 'http://127.0.0.1:3351',
  PUSH_API_KEY: 'pak',
  REVIEW_PUBLIC_BASE_URL: 'https://gostyle.app/review/',
  INVITE_SENDER: 'log',
});

const problems = (env: Record<string, string>, readFile?: (p: string) => string): string[] => {
  try {
    loadConfig(env, readFile);
    return [];
  } catch (e) {
    expect(e).toBeInstanceOf(ConfigError);
    return (e as ConfigError).problems;
  }
};

describe('loadConfig', () => {
  it('builds a config from a complete environment, with defaults for tunables', () => {
    const c = loadConfig(base());
    expect(c.port).toBe(3352);
    expect(c.platform.apiUrl).toBe('http://127.0.0.1:3000');
    expect(c.reviewPublicBaseUrl).toBe('https://gostyle.app/review');
    expect(c.retention).toEqual({ expiredInviteDays: 90, closedReportDays: 365 });
    expect(c.inviteSendRetryAttempts).toBe(5);
    expect(c.whatsapp).toBeNull();
    expect(c.isProduction).toBe(false);
  });

  it('names EVERY missing variable at once, so a deploy is fixed in one pass', () => {
    const env = base();
    delete env.JWT_ACCESS_SECRET;
    delete env.REDIS_HOST;
    delete env.SERVICE_KEY_OPS;
    const p = problems(env);
    expect(p).toEqual(
      expect.arrayContaining([
        'JWT_ACCESS_SECRET (or JWT_ACCESS_SECRET_FILE) is required',
        'REDIS_HOST is required',
        'SERVICE_KEY_OPS (or SERVICE_KEY_OPS_FILE) is required',
      ]),
    );
    expect(p).toHaveLength(3);
  });

  it('treats a blank value as missing', () => {
    expect(problems({ ...base(), PUSH_API_KEY: '   ' })).toEqual([
      'PUSH_API_KEY (or PUSH_API_KEY_FILE) is required',
    ]);
  });

  it('NEVER puts a value in an error message', () => {
    const p = problems({ ...base(), DATABASE_URL: 'mysql://secret-password@x', PORT: 'abc' });
    expect(p.join(' ')).not.toContain('secret-password');
    expect(p).toContain('DATABASE_URL must be a postgres:// URL');
  });

  it('reads a secret from <NAME>_FILE, and the file wins over the variable', () => {
    const c = loadConfig(
      { ...base(), JWT_ACCESS_SECRET: 'from-env', JWT_ACCESS_SECRET_FILE: '/run/secrets/jwt' },
      () => 'from-file\n',
    );
    expect(c.jwtAccessSecret).toBe('from-file');
  });

  it('does not fall back to the variable when the named file cannot be read', () => {
    const p = problems({ ...base(), JWT_ACCESS_SECRET_FILE: '/missing' }, () => {
      throw new Error('ENOENT');
    });
    expect(p).toEqual(['JWT_ACCESS_SECRET_FILE points at a file that cannot be read']);
  });

  it('refuses two callers sharing one service key', () => {
    expect(problems({ ...base(), SERVICE_KEY_OPS: 'k-platform' })).toEqual([
      'SERVICE_KEY_* values must all be different: one key per caller',
    ]);
  });

  it('refuses short service keys in production only', () => {
    expect(problems({ ...base(), NODE_ENV: 'production' })[0]).toMatch(
      /at least 32 characters in production/,
    );
  });

  it('requires the WhatsApp settings only when the WhatsApp sender is chosen', () => {
    const p = problems({ ...base(), INVITE_SENDER: 'whatsapp' });
    expect(p).toEqual(
      expect.arrayContaining([
        'WHATSAPP_PHONE_NUMBER_ID is required',
        'WHATSAPP_INVITE_TEMPLATE_EN is required',
        'WHATSAPP_INVITE_TEMPLATE_AR is required',
      ]),
    );
    expect(problems({ ...base(), INVITE_SENDER: 'sms' })).toEqual([
      'INVITE_SENDER must be one of: log, log_link, whatsapp',
    ]);
  });

  it('turns Swagger on only for the exact value true', () => {
    expect(loadConfig(base()).swaggerEnabled).toBe(false);
    expect(loadConfig({ ...base(), SWAGGER_ENABLED: 'true' }).swaggerEnabled).toBe(true);
    for (const v of ['1', 'TRUE ', 'yes', 'True', 'true ', 'false', '']) {
      expect(loadConfig({ ...base(), SWAGGER_ENABLED: v }).swaggerEnabled, JSON.stringify(v)).toBe(false);
    }
  });

  it('allows INVITE_SENDER=log_link outside production only', () => {
    expect(loadConfig({ ...base(), INVITE_SENDER: 'log_link' }).inviteSender).toBe('log_link');
    expect(problems({ ...base(), NODE_ENV: 'production', INVITE_SENDER: 'log_link' })).toContain(
      'INVITE_SENDER=log_link is not allowed in production: it writes review links to the log',
    );
  });

  it('bounds numeric tunables', () => {
    expect(problems({ ...base(), INVITE_SEND_RETRY_ATTEMPTS: '-1' })).toEqual([
      'INVITE_SEND_RETRY_ATTEMPTS must be a whole number between 0 and 20',
    ]);
  });
});
