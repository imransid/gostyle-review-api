import { randomBytes } from 'node:crypto';

/**
 * A UUID version 7 (RFC 9562): 48 bits of Unix milliseconds, then random.
 *
 * Time-ordered, so ids minted in the domain sort by creation and index well.
 * Minted here rather than by the database because an aggregate needs its id
 * before it is saved: its events carry it.
 *
 * Not monotonic within one millisecond. Nothing here depends on that; ordering
 * that matters (the outbox) orders by created_at.
 */
export function uuidv7(now: number = Date.now()): string {
  const b = randomBytes(16);
  let ms = BigInt(now);
  for (let i = 5; i >= 0; i--) {
    b[i] = Number(ms & 0xffn);
    ms >>= 8n;
  }
  b[6] = (b[6] & 0x0f) | 0x70; // version 7
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}
