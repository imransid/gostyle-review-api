import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../src/review/domain/domain.error';
import { hashInviteToken } from '../../../src/review/domain/services/review-invite-rules';
import { AuthorName } from '../../../src/review/domain/value-objects/author-name';
import { BookingRef } from '../../../src/review/domain/value-objects/booking-ref';
import { Comment } from '../../../src/review/domain/value-objects/comment';
import { InviteToken } from '../../../src/review/domain/value-objects/invite-token';
import { Rating } from '../../../src/review/domain/value-objects/rating';
import { ReviewLanguage } from '../../../src/review/domain/value-objects/review-language';
import { SubjectRef } from '../../../src/review/domain/value-objects/subject-ref';

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError);
    const d = e as DomainError;
    return `${d.code}:${d.details.map((x) => `${x.field}/${x.code}`).join(',')}`;
  }
  return 'no error';
};

const T = '0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b';
const S = '0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2c';
const B = '0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2d';

describe('Rating', () => {
  it('accepts every whole star from 1 to 5', () => {
    for (const n of [1, 2, 3, 4, 5]) expect(Rating.of(n).value).toBe(n);
  });

  it('refuses 0, 6, fractions and non-numbers with VALIDATION_FAILED', () => {
    expect(codeOf(() => Rating.of(0))).toBe('VALIDATION_FAILED:rating/OUT_OF_RANGE');
    expect(codeOf(() => Rating.of(6))).toBe('VALIDATION_FAILED:rating/OUT_OF_RANGE');
    expect(codeOf(() => Rating.of(4.5))).toBe('VALIDATION_FAILED:rating/REQUIRED');
    expect(codeOf(() => Rating.of('5'))).toBe('VALIDATION_FAILED:rating/REQUIRED');
  });
});

describe('Comment', () => {
  it('is optional, and a blank one becomes null, never an empty string', () => {
    expect(Comment.of(undefined).value).toBeNull();
    expect(Comment.of(null).value).toBeNull();
    expect(Comment.of('   \n ').value).toBeNull();
  });

  it('is trimmed and capped at 1000 characters', () => {
    expect(Comment.of('  good  ').value).toBe('good');
    expect(Comment.of('x'.repeat(1000)).value).toHaveLength(1000);
    expect(codeOf(() => Comment.of('x'.repeat(1001)))).toBe('VALIDATION_FAILED:comment/TOO_LONG');
  });
});

describe('AuthorName', () => {
  it('stores a blank name as entered and renders it as "Verified customer"', () => {
    const n = AuthorName.of('');
    expect(n.stored).toBe('');
    expect(n.display()).toBe('Verified customer');
  });

  it('caps at 60', () => {
    expect(AuthorName.of('x'.repeat(60)).stored).toHaveLength(60);
    expect(codeOf(() => AuthorName.of('x'.repeat(61)))).toBe(
      'VALIDATION_FAILED:authorDisplayName/TOO_LONG',
    );
  });
});

describe('ReviewLanguage', () => {
  it('is EN or AR', () => {
    expect(ReviewLanguage.of('EN').value).toBe('EN');
    expect(ReviewLanguage.of('AR').value).toBe('AR');
    expect(codeOf(() => ReviewLanguage.of('FR'))).toBe('VALIDATION_FAILED:language/UNKNOWN_VALUE');
  });
});

describe('InviteToken', () => {
  it('is 32 random bytes as base64url, stored only as its SHA-256', () => {
    const t = InviteToken.mint();
    expect(Buffer.from(t.reveal(), 'base64url')).toHaveLength(32);
    expect(t.reveal()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(t.hash).toBe(hashInviteToken(t.reveal()));
    expect(InviteToken.hashOf(t.reveal())).toBe(t.hash);
  });

  it('NEVER prints the plaintext: not in strings, JSON or inspect', () => {
    const t = InviteToken.mint();
    const plain = t.reveal();
    expect(String(t)).not.toContain(plain);
    expect(`${t}`).not.toContain(plain);
    expect(JSON.stringify({ t })).not.toContain(plain);
    expect(inspect(t)).not.toContain(plain);
    expect(inspect({ nested: { t } })).not.toContain(plain);
  });
});

describe('BookingRef', () => {
  it('names the booking system: platform or booking_api', () => {
    expect(BookingRef.of('platform', B).source).toBe('platform');
    expect(BookingRef.of('booking_api', B.toUpperCase()).id).toBe(B);
    expect(codeOf(() => BookingRef.of('pos', B))).toBe('VALIDATION_FAILED:bookingSource/UNKNOWN_VALUE');
    expect(codeOf(() => BookingRef.of('platform', 'GS-1050'))).toBe(
      'VALIDATION_FAILED:bookingId/INVALID_FORMAT',
    );
  });

  it('the same id from two systems is two bookings', () => {
    expect(BookingRef.of('platform', B).equals(BookingRef.of('booking_api', B))).toBe(false);
  });
});

describe('SubjectRef', () => {
  it('needs a tenant, storefront and branch, all uuids', () => {
    expect(codeOf(() => SubjectRef.of({ tenantId: T, storefrontId: 'x', branchId: undefined }))).toBe(
      'VALIDATION_FAILED:storefrontId/INVALID_FORMAT,branchId/INVALID_FORMAT',
    );
  });

  it('is owned only by its own tenant AND branch', () => {
    const s = SubjectRef.of({ tenantId: T, storefrontId: S, branchId: B });
    expect(s.ownedBy({ tenantId: T, branchId: B })).toBe(true);
    expect(s.ownedBy({ tenantId: T, branchId: S })).toBe(false);
    expect(s.ownedBy({ tenantId: S, branchId: B })).toBe(false);
  });
});
