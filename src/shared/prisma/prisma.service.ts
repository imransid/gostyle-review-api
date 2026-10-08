import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { AppConfig } from '../config/app-config';

/**
 * The pool configuration, as a value so its spec can assert the load-bearing
 * parts. Same settings as booking-api's prisma.service.ts, for the same
 * reasons.
 */
export function poolConfig(connectionString: string) {
  return {
    connectionString,
    // Every session speaks UTC whatever the server default is. The invite
    // expiry and the outbox retry clock are compared against the DATABASE's
    // now(); a +06 session would make every live invite look expired.
    options: '-c timezone=UTC',
    // pg has no connect timeout by default. A hung connect fails fast.
    connectionTimeoutMillis: 5_000,
    max: 10,
    idleTimeoutMillis: 30_000,
  };
}

/** What a repository receives as its optional `tx`. */
export type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'
>;

/**
 * The one PrismaClient for the process, shared by every repository.
 *
 * Prisma 7 has no built-in connection engine: the client MUST be given a
 * driver adapter. The URL comes from AppConfig, not from the environment.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private static readonly log = new Logger(PrismaService.name);

  constructor(config: AppConfig) {
    super({ adapter: new PrismaPg(poolConfig(config.databaseUrl)) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    PrismaService.log.log('Database connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Round trip to the database, for /health. Milliseconds. */
  async ping(): Promise<number> {
    const started = performance.now();
    await this.$queryRaw`SELECT 1`;
    return Math.round((performance.now() - started) * 100) / 100;
  }

  /** `tx` when inside a transaction, the client otherwise. */
  db(tx?: Tx): Tx {
    return tx ?? this;
  }
}
