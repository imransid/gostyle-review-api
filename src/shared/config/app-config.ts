import { readFileSync } from 'node:fs';

/**
 * Every setting the service reads, validated once at boot.
 *
 * THIS IS THE ONLY FILE THAT READS THE ENVIRONMENT (prisma.config.ts aside,
 * which configures the Prisma CLI, not the running app). Everything else
 * receives an AppConfig. A value read in six files is a value with six
 * defaults, and the push service shipped exactly that.
 *
 * Boot fails on the first problem, but the error lists EVERY problem at once,
 * so a fresh deployment is fixed in one pass rather than one restart per
 * missing variable. The message names variables, never their values.
 *
 * Secrets accept a `<NAME>_FILE` variant pointing at a mounted file (the
 * Docker secret convention). The file wins when both are set: a leftover
 * environment variable must not silently shadow a secret someone mounted on
 * purpose. Same rule as booking-api's JWT_ACCESS_SECRET_FILE.
 */

export type NodeEnv = 'development' | 'test' | 'production';
export type InviteSenderKind = 'log' | 'whatsapp';

/** Who may call review-service's internal routes. One key each. */
export const SERVICE_CALLERS = ['platform', 'booking-api', 'customer-api', 'ops'] as const;
export type ServiceCaller = (typeof SERVICE_CALLERS)[number];

export interface WhatsAppSettings {
  phoneNumberId: string;
  accessToken: string;
  /** A pre-approved template per language; WhatsApp refuses free text outside the 24h window. */
  templateEn: string;
  templateAr: string;
  apiVersion: string;
}

export class AppConfig {
  readonly nodeEnv!: NodeEnv;
  readonly port!: number;
  readonly logLevel!: string;
  /** How many reverse proxies sit in front of the app. 0 trusts nobody's X-Forwarded-For. */
  readonly trustProxyHops!: number;

  readonly databaseUrl!: string;
  readonly redis!: { host: string; port: number; password: string };

  /** HS256 secret gostyle-api signs staff tokens with. Same value, both sides. */
  readonly jwtAccessSecret!: string;

  readonly platform!: {
    /** gostyle-api, for /v1/auth/me and the internal lookups. */
    apiUrl: string;
    /** The key review-service presents to the platform's internal routes. */
    internalKey: string;
  };

  /** Keys callers present to /internal/*, by caller. */
  readonly serviceKeys!: Readonly<Record<ServiceCaller, string>>;

  readonly customerApi!: { url: string; key: string };
  readonly push!: { url: string; key: string };

  /** The review form; the invite link is `${base}/${token}`. */
  readonly reviewPublicBaseUrl!: string;

  readonly inviteSender!: InviteSenderKind;
  readonly whatsapp!: WhatsAppSettings | null;
  /** Retries of a FAILED invite send. 0 reproduces the platform: never resend. */
  readonly inviteSendRetryAttempts!: number;

  readonly outboxRelayIntervalMs!: number;
  readonly recomputeCron!: string;
  readonly recomputeTimezone!: string;

  /** Config only. Nothing deletes on these yet (see docs/DECISIONS.md). */
  readonly retention!: { expiredInviteDays: number; closedReportDays: number };

  readonly permissionCacheTtlMs!: number;
  readonly httpTimeoutMs!: number;

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  static from(values: Omit<AppConfig, 'isProduction'>): AppConfig {
    return Object.assign(new AppConfig(), values);
  }
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(
      `review-service cannot start, ${problems.length} configuration problem(s):\n` +
        problems.map((p) => `  - ${p}`).join('\n'),
    );
    this.name = 'ConfigError';
  }
}

type Env = Record<string, string | undefined>;
type ReadFile = (path: string) => string;

const defaultReadFile: ReadFile = (path) => readFileSync(path, 'utf8');

/**
 * Build the config from an environment, or throw a ConfigError naming every
 * problem. Pure apart from reading `_FILE` secrets, which `readFile` stubs.
 */
export function loadConfig(env: Env, readFile: ReadFile = defaultReadFile): AppConfig {
  const problems: string[] = [];

  const raw = (name: string): string | undefined => {
    const v = env[name];
    return v === undefined || v.trim() === '' ? undefined : v.trim();
  };

  const required = (name: string): string => {
    const v = raw(name);
    if (v === undefined) problems.push(`${name} is required`);
    return v ?? '';
  };

  const secret = (name: string): string => {
    const file = raw(`${name}_FILE`);
    if (file !== undefined) {
      try {
        const contents = readFile(file).trim();
        if (contents === '') problems.push(`${name}_FILE points at an empty file`);
        return contents;
      } catch {
        // Not a fall back to the plain variable: someone asked for a file.
        problems.push(`${name}_FILE points at a file that cannot be read`);
        return '';
      }
    }
    const v = raw(name);
    if (v === undefined) problems.push(`${name} (or ${name}_FILE) is required`);
    return v ?? '';
  };

  const int = (name: string, fallback: number | null, min = 0, max = Number.MAX_SAFE_INTEGER) => {
    const v = raw(name);
    if (v === undefined) {
      if (fallback === null) problems.push(`${name} is required`);
      return fallback ?? 0;
    }
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) {
      problems.push(`${name} must be a whole number between ${min} and ${max}`);
      return fallback ?? 0;
    }
    return n;
  };

  const oneOf = <T extends string>(name: string, allowed: readonly T[]): T => {
    const v = required(name);
    if (v !== '' && !(allowed as readonly string[]).includes(v)) {
      problems.push(`${name} must be one of: ${allowed.join(', ')}`);
    }
    return v as T;
  };

  const url = (name: string): string => {
    const v = required(name);
    if (v !== '') {
      try {
        const u = new URL(v);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocol');
      } catch {
        problems.push(`${name} must be an http(s) URL`);
      }
    }
    return v.replace(/\/+$/, '');
  };

  const nodeEnv = oneOf<NodeEnv>('NODE_ENV', ['development', 'test', 'production']);
  const port = int('PORT', null, 1, 65535);

  const databaseUrl = secret('DATABASE_URL');
  if (databaseUrl !== '' && !/^postgres(ql)?:\/\//.test(databaseUrl)) {
    problems.push('DATABASE_URL must be a postgres:// URL');
  }

  const redis = {
    host: required('REDIS_HOST'),
    port: int('REDIS_PORT', null, 1, 65535),
    password: secret('REDIS_PASSWORD'),
  };

  const serviceKeys = {
    platform: secret('SERVICE_KEY_PLATFORM'),
    'booking-api': secret('SERVICE_KEY_BOOKING_API'),
    'customer-api': secret('SERVICE_KEY_CUSTOMER_API'),
    ops: secret('SERVICE_KEY_OPS'),
  } satisfies Record<ServiceCaller, string>;

  // A key shared by two callers is one caller with two names: the guard could
  // no longer say who called, and revoking one would revoke both.
  const present = Object.values(serviceKeys).filter((k) => k !== '');
  if (new Set(present).size !== present.length) {
    problems.push('SERVICE_KEY_* values must all be different: one key per caller');
  }

  const inviteSender = oneOf<InviteSenderKind>('INVITE_SENDER', ['log', 'whatsapp']);
  let whatsapp: WhatsAppSettings | null = null;
  if (inviteSender === 'whatsapp') {
    whatsapp = {
      phoneNumberId: required('WHATSAPP_PHONE_NUMBER_ID'),
      accessToken: secret('WHATSAPP_ACCESS_TOKEN'),
      templateEn: required('WHATSAPP_INVITE_TEMPLATE_EN'),
      templateAr: required('WHATSAPP_INVITE_TEMPLATE_AR'),
      apiVersion: raw('WHATSAPP_API_VERSION') ?? 'v23.0',
    };
  }

  const config = AppConfig.from({
    nodeEnv,
    port,
    logLevel: raw('LOG_LEVEL') ?? 'info',
    trustProxyHops: int('TRUST_PROXY_HOPS', 0, 0, 10),
    databaseUrl,
    redis,
    jwtAccessSecret: secret('JWT_ACCESS_SECRET'),
    platform: {
      apiUrl: url('PLATFORM_API_URL'),
      internalKey: secret('PLATFORM_INTERNAL_KEY'),
    },
    serviceKeys,
    customerApi: { url: url('CUSTOMER_API_URL'), key: secret('CUSTOMER_API_KEY') },
    push: { url: url('PUSH_API_URL'), key: secret('PUSH_API_KEY') },
    reviewPublicBaseUrl: url('REVIEW_PUBLIC_BASE_URL'),
    inviteSender,
    whatsapp,
    inviteSendRetryAttempts: int('INVITE_SEND_RETRY_ATTEMPTS', 5, 0, 20),
    outboxRelayIntervalMs: int('OUTBOX_RELAY_INTERVAL_MS', 1000, 200, 60_000),
    recomputeCron: raw('RECOMPUTE_CRON') ?? '0 3 * * *',
    recomputeTimezone: raw('RECOMPUTE_TZ') ?? 'UTC',
    retention: {
      expiredInviteDays: int('RETENTION_EXPIRED_INVITE_DAYS', 90, 1, 3650),
      closedReportDays: int('RETENTION_CLOSED_REPORT_DAYS', 365, 1, 3650),
    },
    permissionCacheTtlMs: int('PERMISSION_CACHE_TTL_MS', 30_000, 0, 600_000),
    httpTimeoutMs: int('HTTP_TIMEOUT_MS', 5_000, 100, 60_000),
  });

  if (config.nodeEnv === 'production') {
    // Short shared secrets are guessable; production gets no placeholders.
    const short = Object.entries(serviceKeys)
      .filter(([, k]) => k !== '' && k.length < 32)
      .map(([caller]) => caller);
    if (short.length > 0) {
      problems.push(`service keys must be at least 32 characters in production: ${short.join(', ')}`);
    }
  }

  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}
