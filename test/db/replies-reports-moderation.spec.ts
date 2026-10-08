import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  HideReviewCommand,
  RemoveReviewCommand,
  RestoreReviewCommand,
} from '../../src/review/application/commands/moderate-review/moderate-review.commands';
import {
  DeleteReplyCommand,
  EditReplyCommand,
  PostReplyCommand,
} from '../../src/review/application/commands/post-reply/reply-commands';
import { ReportReviewCommand } from '../../src/review/application/commands/report-review/report-review.command';
import {
  DismissReportCommand,
  UpholdReportCommand,
} from '../../src/review/application/commands/uphold-report/report-decisions';
import { EraseCustomerReviewsCommand } from '../../src/review/application/commands/erase-customer-reviews/erase-customer-reviews.command';
import { SubmitReviewCommand } from '../../src/review/application/commands/submit-review/submit-review.command';
import { CreateReviewInviteCommand } from '../../src/review/application/commands/create-review-invite/create-review-invite.command';
import { uuidv7 } from '../../src/review/domain/shared/uuidv7';
import { codeOf, harness, NOTE, resetTables, salonOf, testPrisma, type Harness } from './harness';

const prisma = testPrisma();
let h: Harness;

beforeEach(async () => {
  await resetTables(prisma);
  h = harness(prisma);
});
afterAll(() => prisma.$disconnect());

const summaryOf = (storefrontId: string) =>
  prisma.ratingSummary.findUnique({
    where: { subjectType_subjectId: { subjectType: 'STOREFRONT', subjectId: storefrontId } },
  });

describe('replies', () => {
  it('one reply per review, written by that salon, edited in place, HARD deleted', async () => {
    const s = h.storefronts.add();
    const { reviewId } = await h.review(s);
    const staff = salonOf(s);

    const posted = await h.postReply.execute(new PostReplyCommand({ ...staff, reviewId, body: ' Thanks! ' }));
    expect(posted.body).toBe('Thanks!');
    expect(await codeOf(h.postReply.execute(new PostReplyCommand({ ...staff, reviewId, body: 'Again' })))).toBe(
      'REPLY_ALREADY_EXISTS',
    );

    const other = salonOf(s);
    const edited = await h.editReply.execute(new EditReplyCommand({ ...other, reviewId, body: 'Thank you.' }));
    expect(edited.editedAt).not.toBeNull();
    const row = await prisma.reviewReply.findUniqueOrThrow({ where: { reviewId } });
    expect(row).toMatchObject({ body: 'Thank you.', authorId: staff.actorId, editedById: other.actorId });

    await h.deleteReply.execute(new DeleteReplyCommand({ ...staff, reviewId }));
    expect(await prisma.reviewReply.count()).toBe(0);
    expect(await codeOf(h.deleteReply.execute(new DeleteReplyCommand({ ...staff, reviewId })))).toBe(
      'REPLY_NOT_FOUND',
    );
    // Deleting freed the slot.
    await h.postReply.execute(new PostReplyCommand({ ...staff, reviewId, body: 'Second answer' }));
    expect(await prisma.reviewReply.count()).toBe(1);
  });

  it('another salon, or another branch of the same tenant, gets REVIEW_NOT_FOUND', async () => {
    const s = h.storefronts.add();
    const { reviewId } = await h.review(s);
    const otherTenant = { tenantId: uuidv7(), branchId: s.branchId, actorId: uuidv7() };
    const otherBranch = { tenantId: s.tenantId, branchId: uuidv7(), actorId: uuidv7() };
    for (const who of [otherTenant, otherBranch]) {
      expect(await codeOf(h.postReply.execute(new PostReplyCommand({ ...who, reviewId, body: 'x' })))).toBe(
        'REVIEW_NOT_FOUND',
      );
      expect(await codeOf(h.report.execute(new ReportReviewCommand({ ...who, reviewId, reason: 'HARASSMENT' })))).toBe(
        'REVIEW_NOT_FOUND',
      );
    }
    expect(await prisma.reviewReply.count()).toBe(0);
  });

  it('two managers replying at once: one reply, the other told REPLY_ALREADY_EXISTS', async () => {
    const s = h.storefronts.add();
    const { reviewId } = await h.review(s);
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, (_, n) =>
        h.postReply.execute(new PostReplyCommand({ ...salonOf(s), reviewId, body: `reply ${n}` })),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      results
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .every((r) => r.reason.code === 'REPLY_ALREADY_EXISTS'),
    ).toBe(true);
    expect(await prisma.reviewReply.count()).toBe(1);
  });
});

describe('reports', () => {
  it('FILING NEVER HIDES: the review stays PUBLISHED and the rating does not move', async () => {
    const s = h.storefronts.add();
    const { reviewId } = await h.review(s, 1);
    const before = await summaryOf(s.storefrontId);
    const filed = await h.report.execute(
      new ReportReviewCommand({ ...salonOf(s), reviewId, reason: 'FAKE_NO_VISIT', note: 'no booking matches' }),
    );
    expect(filed).toMatchObject({ status: 'OPEN', reviewState: 'PUBLISHED' });
    expect((await prisma.review.findUniqueOrThrow({ where: { id: reviewId } })).state).toBe('PUBLISHED');
    const after = await summaryOf(s.storefrontId);
    expect(after?.reviewCount).toBe(1);
    expect(after?.version).toBe(before?.version);
  });

  it('at most one OPEN report per review; a dismissed one allows a new report', async () => {
    const s = h.storefronts.add();
    const { reviewId } = await h.review(s);
    const staff = salonOf(s);
    const first = await h.report.execute(new ReportReviewCommand({ ...staff, reviewId, reason: 'HARASSMENT' }));
    expect(
      await codeOf(h.report.execute(new ReportReviewCommand({ ...staff, reviewId, reason: 'OFF_TOPIC_OR_SPAM' }))),
    ).toBe('REPORT_ALREADY_OPEN');
    await h.dismiss.execute(new DismissReportCommand({ reportId: first.reportId, reviewerId: uuidv7(), note: NOTE }));
    await h.report.execute(new ReportReviewCommand({ ...staff, reviewId, reason: 'OFF_TOPIC_OR_SPAM' }));
    expect(await prisma.reviewReport.count()).toBe(2);
  });

  it('UPHELD hides the review and takes it out of the rating, in one transaction', async () => {
    const s = h.storefronts.add();
    await h.review(s, 5);
    const { reviewId } = await h.review(s, 1);
    expect((await summaryOf(s.storefrontId))?.reviewCount).toBe(2);
    const { reportId } = await h.report.execute(
      new ReportReviewCommand({ ...salonOf(s), reviewId, reason: 'HARASSMENT' }),
    );
    const hq = uuidv7();
    const decided = await h.uphold.execute(new UpholdReportCommand({ reportId, reviewerId: hq, note: NOTE }));
    expect(decided).toMatchObject({ status: 'UPHELD', reviewState: 'HIDDEN', resolvedById: hq });
    const review = await prisma.review.findUniqueOrThrow({ where: { id: reviewId } });
    expect(review).toMatchObject({ state: 'HIDDEN', moderatedById: hq, moderationNote: NOTE });
    const sum = await summaryOf(s.storefrontId);
    expect(sum).toMatchObject({ reviewCount: 1, ratingSum: 5, star1: 0, star5: 1 });
  });

  it('DISMISSED leaves the review exactly as it was', async () => {
    const s = h.storefronts.add();
    const { reviewId } = await h.review(s, 2);
    const { reportId } = await h.report.execute(new ReportReviewCommand({ ...salonOf(s), reviewId, reason: 'HARASSMENT' }));
    const before = await prisma.review.findUniqueOrThrow({ where: { id: reviewId } });
    const decided = await h.dismiss.execute(new DismissReportCommand({ reportId, reviewerId: uuidv7(), note: NOTE }));
    expect(decided).toMatchObject({ status: 'DISMISSED', reviewState: 'PUBLISHED' });
    const after = await prisma.review.findUniqueOrThrow({ where: { id: reviewId } });
    expect(after).toEqual(before);
  });

  it('two reviewers deciding one report at once: one wins, the other is REPORT_TRANSITION_INVALID', async () => {
    const s = h.storefronts.add();
    const { reviewId } = await h.review(s);
    const { reportId } = await h.report.execute(new ReportReviewCommand({ ...salonOf(s), reviewId, reason: 'HARASSMENT' }));
    const results = await Promise.allSettled([
      h.uphold.execute(new UpholdReportCommand({ reportId, reviewerId: uuidv7(), note: NOTE })),
      h.dismiss.execute(new DismissReportCommand({ reportId, reviewerId: uuidv7(), note: NOTE })),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected?.reason.code).toBe('REPORT_TRANSITION_INVALID');
  });

  it('a decision needs a real reason', async () => {
    const s = h.storefronts.add();
    const { reviewId } = await h.review(s);
    const { reportId } = await h.report.execute(new ReportReviewCommand({ ...salonOf(s), reviewId, reason: 'HARASSMENT' }));
    expect(await codeOf(h.uphold.execute(new UpholdReportCommand({ reportId, reviewerId: uuidv7(), note: 'no' })))).toBe(
      'VALIDATION_FAILED',
    );
    expect((await prisma.reviewReport.findUniqueOrThrow({ where: { id: reportId } })).status).toBe('OPEN');
  });
});

describe('moderation', () => {
  it('hide <-> restore moves the review in and out of the rating; remove is final', async () => {
    const s = h.storefronts.add();
    const { reviewId } = await h.review(s, 3);
    const hq = { reviewId, moderatorId: uuidv7(), note: NOTE };

    await h.hide.execute(new HideReviewCommand(hq));
    expect((await summaryOf(s.storefrontId))?.reviewCount).toBe(0);
    await h.restore.execute(new RestoreReviewCommand(hq));
    expect((await summaryOf(s.storefrontId))?.reviewCount).toBe(1);
    const removed = await h.remove.execute(new RemoveReviewCommand(hq));
    expect(removed.state).toBe('REMOVED');
    expect((await summaryOf(s.storefrontId))?.reviewCount).toBe(0);

    for (const cmd of [new RestoreReviewCommand(hq), new HideReviewCommand(hq), new RemoveReviewCommand(hq)]) {
      const handler = cmd instanceof RestoreReviewCommand ? h.restore : cmd instanceof HideReviewCommand ? h.hide : h.remove;
      expect(await codeOf(handler.execute(cmd as never))).toBe('REVIEW_TRANSITION_INVALID');
    }
  });

  it('a REMOVED review cannot be replaced: its booking is still taken', async () => {
    const s = h.storefronts.add();
    const { reviewId, invite } = await h.review(s);
    await h.remove.execute(new RemoveReviewCommand({ reviewId, moderatorId: uuidv7(), note: NOTE }));
    // Even with a fresh invite row for the same booking forced in by hand, the
    // review's unique booking key refuses a second review.
    await prisma.reviewInvite.update({ where: { id: invite.id }, data: { usedAt: null } });
    const fresh = await h.createInvite.execute(
      new CreateReviewInviteCommand({
        bookingSource: invite.booking.source,
        bookingId: invite.booking.id,
        branchId: s.branchId,
        tenantId: s.tenantId,
        customerId: null,
      }),
    );
    expect(fresh.outcome).toBe('already_invited');
  });

  it('an upheld report never resurrects a REMOVED review', async () => {
    const s = h.storefronts.add();
    const { reviewId } = await h.review(s);
    const { reportId } = await h.report.execute(new ReportReviewCommand({ ...salonOf(s), reviewId, reason: 'HARASSMENT' }));
    await h.remove.execute(new RemoveReviewCommand({ reviewId, moderatorId: uuidv7(), note: NOTE }));
    const decided = await h.uphold.execute(new UpholdReportCommand({ reportId, reviewerId: uuidv7(), note: NOTE }));
    expect(decided).toMatchObject({ status: 'UPHELD', reviewState: 'REMOVED' });
    expect((await prisma.review.findUniqueOrThrow({ where: { id: reviewId } })).state).toBe('REMOVED');
  });
});

describe('erasure', () => {
  it('blanks the author name and customer id, keeps the review and the rating', async () => {
    const s = h.storefronts.add();
    const customerId = uuidv7();
    h.contacts.byCustomer.set(customerId, { displayName: 'Sara', phone: '+971500000000' });
    const { token } = await h.invite(s, { customerId });
    const { reviewId } = await h.submit.execute(new SubmitReviewCommand({ token, rating: 5, language: 'EN' }));
    const r = await h.erase.execute(new EraseCustomerReviewsCommand({ customerId, tenantId: s.tenantId }));
    expect(r).toEqual({ reviews: 1, invites: 1, duplicate: false });
    const review = await prisma.review.findUniqueOrThrow({ where: { id: reviewId } });
    expect(review).toMatchObject({ customerId: null, authorDisplayName: '', rating: 5 });
    expect((await summaryOf(s.storefrontId))?.reviewCount).toBe(1);
  });
});
