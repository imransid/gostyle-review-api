import { Injectable } from '@nestjs/common';
import type { TxHandle, UnitOfWork } from '../../review/domain/ports/unit-of-work.port';
import { PrismaService, type Tx } from './prisma.service';

/** The opaque handle the layers above pass around, back to a Prisma client. */
export function asPrisma(prisma: PrismaService, tx?: TxHandle): Tx {
  return tx === undefined ? prisma : (tx as unknown as Tx);
}

/** One interactive Prisma transaction per unit of work. */
@Injectable()
export class PrismaUnitOfWork implements UnitOfWork {
  constructor(private readonly prisma: PrismaService) {}

  run<T>(work: (tx: TxHandle) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => work(tx as unknown as TxHandle), {
      // A review write is a handful of statements; anything slower than this
      // is a lock wait, and failing it beats holding a connection forever.
      timeout: 15_000,
      maxWait: 5_000,
    });
  }
}

/**
 * Whether an error is a unique violation, optionally on a named index.
 *
 * Prisma reports P2002; through the pg adapter some paths surface Postgres's
 * own 23505. Both are checked, as the platform's adapters do. The index name
 * is matched against whatever the error carries (meta.target or the message)
 * so one handler can tell "this booking already has a review" from any other
 * unique index.
 */
export function isUniqueViolation(e: unknown, index?: string): boolean {
  const err = e as { code?: string; meta?: Record<string, unknown>; message?: string } | null;
  if (!err || (err.code !== 'P2002' && err.code !== '23505')) return false;
  if (index === undefined) return true;
  const haystack = JSON.stringify(err.meta ?? {}) + String(err.message ?? '');
  return haystack.includes(index);
}
