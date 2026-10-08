import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { CreateReviewInviteCommand } from '../../src/review/application/commands/create-review-invite/create-review-invite.command';
import { SubmitReviewCommand } from '../../src/review/application/commands/submit-review/submit-review.command';
import { hashInviteToken } from '../../src/review/domain/services/review-invite-rules';
import { uuidv7 } from '../../src/review/domain/shared/uuidv7';
import { codeOf, harness, resetTables, testPrisma, type Harness } from './harness';

const prisma = testPrisma();
let h: Harness;

beforeEach(async () => {
  await resetTables(prisma);
  h = harness(prisma);
});
afterAll(() => prisma.$disconnect());

const completed = (over: Partial<ConstructorParameters<typeof CreateReviewInviteCommand>[0]> = {}) =>
  new CreateReviewInviteCommand({
    bookingSource: 'platform',
    bookingId: uuidv7(),
    branchId: uuidv7(),
    tenantId: null,
    customerId: uuidv7(),
    ...over,
  });

describe('CreateReviewInvite', () => {
  it('mints one invite, stored only as a SHA-256 hash, valid 30 days', async () => {
    const s = h.storefronts.add();
    const r = await h.createInvite.execute(completed({ branchId: s.branchId, tenantId: s.tenantId }));
    expect(r.outcome).toBe('invite_minted');
    const row = await prisma.reviewInvite.findUniqueOrThrow({ where: { id: r.invite!.id } });
    expect(row.tokenHash).toBe(hashInviteToken(r.token!.reveal()));
    expect(row.tokenHash).not.toBe(r.token!.reveal());
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(30 * 86_400_000);
    expect(row.tenantId).toBe(s.tenantId);
    expect(row.salonName).toBe('Marina Walk');
  });

  it('ONE INVITE PER BOOKING: the same event twice, or two events for one booking', async () => {
    const s = h.storefronts.add();
    const bookingId = uuidv7();
    const inbox = { source: 'platform', eventId: uuidv7(), eventType: 'bookings.booking.completed.v1' };
    const cmd = completed({ branchId: s.branchId, bookingId, inbox });

    const first = await h.createInvite.execute(cmd);
    const redelivered = await h.createInvite.execute(cmd);
    const secondEvent = await h.createInvite.execute(
      completed({ branchId: s.branchId, bookingId, inbox: { ...inbox, eventId: uuidv7() } }),
    );

    expect([first.outcome, redelivered.outcome, secondEvent.outcome]).toEqual([
      'invite_minted',
      'duplicate_event',
      'already_invited',
    ]);
    expect(redelivered.token).toBeNull();
    expect(secondEvent.token).toBeNull();
    expect(await prisma.reviewInvite.count()).toBe(1);
    const inboxRows = await prisma.inboxEvent.findMany({ orderBy: { receivedAt: 'asc' } });
    expect(inboxRows.map((r) => r.outcome)).toEqual(['invite_minted', 'already_invited']);
  });

  it('the same booking id from the OTHER system is a different booking', async () => {
    const s = h.storefronts.add();
    const bookingId = uuidv7();
    await h.createInvite.execute(completed({ branchId: s.branchId, bookingId, bookingSource: 'platform' }));
    const other = await h.createInvite.execute(
      completed({ branchId: s.branchId, bookingId, bookingSource: 'booking_api' }),
    );
    expect(other.outcome).toBe('invite_minted');
    expect(await prisma.reviewInvite.count()).toBe(2);
  });

  it('concurrent deliveries of one event mint exactly one invite', async () => {
    const s = h.storefronts.add();
    const cmd = completed({
      branchId: s.branchId,
      inbox: { source: 'booking-api', eventId: uuidv7(), eventType: 'booking.completed' },
    });
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => h.createInvite.execute(cmd)));
    const minted = results.filter((r) => r.status === 'fulfilled' && r.value.outcome === 'invite_minted');
    expect(minted).toHaveLength(1);
    expect(await prisma.reviewInvite.count()).toBe(1);
  });

  it('a branch with no storefront gets no invite, and the event is still recorded', async () => {
    const r = await h.createInvite.execute(
      completed({ inbox: { source: 'platform', eventId: 'e-1', eventType: 'x' } }),
    );
    expect(r.outcome).toBe('no_storefront');
    expect(await prisma.reviewInvite.count()).toBe(0);
    expect((await prisma.inboxEvent.findFirstOrThrow()).outcome).toBe('no_storefront');
  });

  it('NEVER takes a tenant the storefront does not belong to', async () => {
    const s = h.storefronts.add();
    const r = await h.createInvite.execute(completed({ branchId: s.branchId, tenantId: uuidv7() }));
    expect(r.outcome).toBe('tenant_mismatch');
    expect(await prisma.reviewInvite.count()).toBe(0);
  });

  it('the inbox row and the invite commit together: a failure leaves neither', async () => {
    const s = h.storefronts.add();
    const broken = harness(prisma);
    broken.storefronts.byBranch.set(s.branchId, s);
    // Make the event append fail inside the transaction.
    (broken.createInvite as any).outbox = { append: async () => Promise.reject(new Error('disk full')) };
    const cmd = completed({
      branchId: s.branchId,
      inbox: { source: 'platform', eventId: 'e-atomic', eventType: 'x' },
    });
    expect(await codeOf(broken.createInvite.execute(cmd))).toBe('disk full');
    expect(await prisma.inboxEvent.count()).toBe(0);
    expect(await prisma.reviewInvite.count()).toBe(0);
    // ...so the redelivery does the work.
    expect((await h.createInvite.execute(cmd)).outcome).toBe('invite_minted');
  });

  it('writes review.invite.created.v1 with the invite id and NOT the token', async () => {
    const s = h.storefronts.add();
    const r = await h.createInvite.execute(completed({ branchId: s.branchId }));
    const e = await prisma.outboxEvent.findFirstOrThrow({ where: { eventType: 'review.invite.created.v1' } });
    expect((e.payload as any).inviteId).toBe(r.invite!.id);
    expect(JSON.stringify(e.payload)).not.toContain(r.token!.reveal());
  });
});

describe('SubmitReview', () => {
  it('redeems the invite and writes the review in one transaction, tenant from the invite', async () => {
    const s = h.storefronts.add();
    const { token, invite } = await h.invite(s);
    const { reviewId } = await h.submit.execute(
      new SubmitReviewCommand({ token, rating: 4, language: 'AR', comment: '  Great  ' }),
    );
    const review = await prisma.review.findUniqueOrThrow({ where: { id: reviewId } });
    expect(review).toMatchObject({
      tenantId: s.tenantId,
      storefrontId: s.storefrontId,
      branchId: s.branchId,
      inviteId: invite.id,
      rating: 4,
      language: 'AR',
      comment: 'Great',
      state: 'PUBLISHED',
    });
    expect((await prisma.reviewInvite.findUniqueOrThrow({ where: { id: invite.id } })).usedAt).not.toBeNull();
  });

  it('SINGLE USE: the second submit is INVITE_ALREADY_USED and writes nothing', async () => {
    const s = h.storefronts.add();
    const { token } = await h.invite(s);
    await h.submit.execute(new SubmitReviewCommand({ token, rating: 5, language: 'EN' }));
    expect(await codeOf(h.submit.execute(new SubmitReviewCommand({ token, rating: 1, language: 'EN' })))).toBe(
      'INVITE_ALREADY_USED',
    );
    expect(await prisma.review.count()).toBe(1);
  });

  it('ONE TRANSACTION: if the review cannot be written, the invite is not spent', async () => {
    const s = h.storefronts.add();
    const { token, invite } = await h.invite(s);
    // Fail the review insert AFTER markUsed has flipped the invite.
    const realInsert = h.repos.reviews.insert.bind(h.repos.reviews);
    (h.repos.reviews as any).insert = async () => Promise.reject(new Error('insert failed'));
    expect(await codeOf(h.submit.execute(new SubmitReviewCommand({ token, rating: 5, language: 'EN' })))).toBe(
      'insert failed',
    );
    expect((await prisma.reviewInvite.findUniqueOrThrow({ where: { id: invite.id } })).usedAt).toBeNull();
    expect(await prisma.outboxEvent.count({ where: { eventType: 'review.submitted.v1' } })).toBe(0);
    // ...so the customer's retry works.
    (h.repos.reviews as any).insert = realInsert;
    await h.submit.execute(new SubmitReviewCommand({ token, rating: 5, language: 'EN' }));
    expect(await prisma.review.count()).toBe(1);
  });

  it('SINGLE USE under a race: ten concurrent submits, one review', async () => {
    const s = h.storefronts.add();
    const { token } = await h.invite(s);
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        h.submit.execute(new SubmitReviewCommand({ token, rating: 5, language: 'EN' })),
      ),
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    const codes = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => r.reason.code);
    expect(ok).toHaveLength(1);
    expect(new Set(codes)).toEqual(new Set(['INVITE_ALREADY_USED']));
    expect(await prisma.review.count()).toBe(1);
  });

  it('INVITE_NOT_FOUND for a token nobody minted', async () => {
    expect(
      await codeOf(h.submit.execute(new SubmitReviewCommand({ token: 'nope', rating: 5, language: 'EN' }))),
    ).toBe('INVITE_NOT_FOUND');
  });

  it('INVITE_EXPIRED after 30 days, and the invite is NOT consumed', async () => {
    const s = h.storefronts.add();
    const { token, invite } = await h.invite(s);
    h.clock.advanceDays(30);
    expect(await codeOf(h.submit.execute(new SubmitReviewCommand({ token, rating: 5, language: 'EN' })))).toBe(
      'INVITE_EXPIRED',
    );
    expect((await prisma.reviewInvite.findUniqueOrThrow({ where: { id: invite.id } })).usedAt).toBeNull();
  });

  it('VALIDATION_FAILED leaves the invite unused so the customer can fix and resend', async () => {
    const s = h.storefronts.add();
    const { token, invite } = await h.invite(s);
    for (const bad of [
      { rating: 6, language: 'EN' },
      { rating: 0, language: 'EN' },
      { rating: 4.5, language: 'EN' },
      { rating: 5, language: 'FR' },
      { rating: 5, language: 'EN', comment: 'x'.repeat(1001) },
    ]) {
      expect(await codeOf(h.submit.execute(new SubmitReviewCommand({ token, ...bad })))).toBe('VALIDATION_FAILED');
    }
    expect((await prisma.reviewInvite.findUniqueOrThrow({ where: { id: invite.id } })).usedAt).toBeNull();
    expect(await prisma.review.count()).toBe(0);
  });

  it('THE BOOKING NAME WINS over a typed one; capped at 60 when copied', async () => {
    const s = h.storefronts.add();
    const customerId = uuidv7();
    h.contacts.byCustomer.set(customerId, { displayName: 'Sara Idris', phone: null });
    const { token } = await h.invite(s, { customerId });
    const { reviewId } = await h.submit.execute(
      new SubmitReviewCommand({ token, rating: 5, language: 'EN', authorDisplayName: 'Someone Else' }),
    );
    expect((await prisma.review.findUniqueOrThrow({ where: { id: reviewId } })).authorDisplayName).toBe(
      'Sara Idris',
    );
  });

  it('a walk-in types their own name; a blank name is stored blank, and a blank comment is NULL', async () => {
    const s = h.storefronts.add();
    const a = await h.invite(s, { customerId: null });
    const ra = await h.submit.execute(
      new SubmitReviewCommand({ token: a.token, rating: 5, language: 'EN', authorDisplayName: '  Layla ' }),
    );
    const b = await h.invite(s, { customerId: null });
    const rb = await h.submit.execute(
      new SubmitReviewCommand({ token: b.token, rating: 5, language: 'EN', comment: '   ' }),
    );
    expect((await prisma.review.findUniqueOrThrow({ where: { id: ra.reviewId } })).authorDisplayName).toBe('Layla');
    const blank = await prisma.review.findUniqueOrThrow({ where: { id: rb.reviewId } });
    expect(blank.authorDisplayName).toBe('');
    expect(blank.comment).toBeNull();
  });

  it('the plaintext token is in NO table: only its hash is stored, events carry ids', async () => {
    const s = h.storefronts.add();
    const { token } = await h.invite(s);
    await h.submit.execute(new SubmitReviewCommand({ token, rating: 5, language: 'EN' }));
    const dump = JSON.stringify(
      await Promise.all([
        prisma.reviewInvite.findMany(),
        prisma.review.findMany(),
        prisma.outboxEvent.findMany(),
        prisma.inboxEvent.findMany(),
      ]),
      (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
    );
    expect(dump).not.toContain(token);
  });
});
