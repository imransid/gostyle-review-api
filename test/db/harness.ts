import { CreateReviewInviteHandler } from '../../src/review/application/commands/create-review-invite/create-review-invite.handler';
import { CreateReviewInviteCommand } from '../../src/review/application/commands/create-review-invite/create-review-invite.command';
import { DeleteReplyHandler } from '../../src/review/application/commands/delete-reply/delete-reply.handler';
import { DismissReportHandler } from '../../src/review/application/commands/dismiss-report/dismiss-report.handler';
import { EditReplyHandler } from '../../src/review/application/commands/edit-reply/edit-reply.handler';
import { EraseCustomerReviewsHandler } from '../../src/review/application/commands/erase-customer-reviews/erase-customer-reviews.handler';
import {
  HideReviewHandler,
  RemoveReviewHandler,
  RestoreReviewHandler,
} from '../../src/review/application/commands/moderate-review/moderate-review.handlers';
import { PostReplyHandler } from '../../src/review/application/commands/post-reply/post-reply.handler';
import { RecomputeRatingSummariesHandler } from '../../src/review/application/commands/recompute-rating-summaries/recompute-rating-summaries.handler';
import { ReportReviewHandler } from '../../src/review/application/commands/report-review/report-review.handler';
import { SubmitReviewHandler } from '../../src/review/application/commands/submit-review/submit-review.handler';
import { SubmitReviewCommand } from '../../src/review/application/commands/submit-review/submit-review.command';
import { UpholdReportHandler } from '../../src/review/application/commands/uphold-report/uphold-report.handler';
import { RatingProjector } from '../../src/review/application/rating/rating-projector';
import type { Contact, ContactDirectory } from '../../src/review/domain/ports/contact-directory.port';
import type { StorefrontDirectory, StorefrontInfo } from '../../src/review/domain/ports/storefront-directory.port';
import { uuidv7 } from '../../src/review/domain/shared/uuidv7';
import type { BookingSource } from '../../src/review/domain/value-objects/booking-ref';
import { PrismaRatingSummaryRepository } from '../../src/review/infrastructure/persistence/prisma-rating-summary.repository';
import { PrismaReviewInviteRepository } from '../../src/review/infrastructure/persistence/prisma-review-invite.repository';
import { PrismaReviewReportRepository } from '../../src/review/infrastructure/persistence/prisma-review-report.repository';
import { PrismaReviewRepository } from '../../src/review/infrastructure/persistence/prisma-review.repository';
import { AppConfig } from '../../src/shared/config/app-config';
import { PrismaInbox, PrismaOutboxWriter } from '../../src/shared/outbox/prisma-outbox';
import { PrismaService } from '../../src/shared/prisma/prisma.service';
import { PrismaUnitOfWork } from '../../src/shared/prisma/prisma-tx';
import { assertLocal, TEST_DATABASE_URL } from '../support/local-db';

export function testPrisma(): PrismaService {
  assertLocal(TEST_DATABASE_URL);
  return new PrismaService({ databaseUrl: TEST_DATABASE_URL } as AppConfig);
}

export async function resetTables(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE review_report, review_reply, review, review_invite, rating_summary, outbox_event, inbox_event',
  );
}

/** A storefront directory that knows the branches it is told about. */
export class FakeStorefronts implements StorefrontDirectory {
  readonly byBranch = new Map<string, StorefrontInfo>();
  calls = 0;
  add(info: Partial<StorefrontInfo> = {}): StorefrontInfo {
    const s: StorefrontInfo = {
      storefrontId: uuidv7(),
      tenantId: uuidv7(),
      branchId: uuidv7(),
      salonName: 'Marina Walk',
      slug: 'marina-walk',
      locale: 'en',
      ...info,
    };
    this.byBranch.set(s.branchId, s);
    return s;
  }
  async findByBranch(branchId: string) {
    this.calls += 1;
    return this.byBranch.get(branchId) ?? null;
  }
}

export class FakeContacts implements ContactDirectory {
  readonly byCustomer = new Map<string, Contact>();
  async find(i: { bookingSource: BookingSource; customerId: string | null }) {
    return i.customerId ? (this.byCustomer.get(i.customerId) ?? null) : null;
  }
}

export class TestClock {
  constructor(public current = new Date()) {}
  now() {
    return new Date(this.current);
  }
  advanceDays(days: number) {
    this.current = new Date(this.current.getTime() + days * 86_400_000);
  }
}

/** The real repositories and handlers over the test database, with fake directories. */
export function harness(prisma: PrismaService) {
  const clock = new TestClock();
  const storefronts = new FakeStorefronts();
  const contacts = new FakeContacts();
  const uow = new PrismaUnitOfWork(prisma);
  const outbox = new PrismaOutboxWriter(prisma);
  const inbox = new PrismaInbox(prisma);
  const reviews = new PrismaReviewRepository(prisma);
  const invites = new PrismaReviewInviteRepository(prisma);
  const reports = new PrismaReviewReportRepository(prisma);
  const summaries = new PrismaRatingSummaryRepository(prisma);
  const projector = new RatingProjector(summaries, outbox);

  const h = {
    prisma,
    clock,
    storefronts,
    contacts,
    repos: { reviews, invites, reports, summaries },
    projector,
    createInvite: new CreateReviewInviteHandler(uow, invites, storefronts, inbox, outbox, clock),
    submit: new SubmitReviewHandler(uow, invites, reviews, contacts, outbox, projector, clock),
    postReply: new PostReplyHandler(uow, reviews, outbox, clock),
    editReply: new EditReplyHandler(uow, reviews, outbox, clock),
    deleteReply: new DeleteReplyHandler(uow, reviews, outbox, clock),
    report: new ReportReviewHandler(uow, reviews, reports, outbox, clock),
    uphold: new UpholdReportHandler(uow, reports, reviews, outbox, projector, clock),
    dismiss: new DismissReportHandler(uow, reports, reviews, outbox, clock),
    hide: new HideReviewHandler(uow, reviews, outbox, projector, clock),
    restore: new RestoreReviewHandler(uow, reviews, outbox, projector, clock),
    remove: new RemoveReviewHandler(uow, reviews, outbox, projector, clock),
    recompute: new RecomputeRatingSummariesHandler(uow, summaries, projector),
    erase: new EraseCustomerReviewsHandler(uow, reviews, invites, inbox),

    /** Mint an invite for a fresh booking at `storefront`; returns the plaintext token. */
    async invite(
      storefront: StorefrontInfo,
      over: Partial<{ bookingSource: BookingSource; bookingId: string; customerId: string | null }> = {},
    ) {
      const r = await h.createInvite.execute(
        new CreateReviewInviteCommand({
          bookingSource: over.bookingSource ?? 'platform',
          bookingId: over.bookingId ?? uuidv7(),
          branchId: storefront.branchId,
          tenantId: storefront.tenantId,
          customerId: over.customerId === undefined ? uuidv7() : over.customerId,
        }),
      );
      if (!r.token || !r.invite) throw new Error(`no invite: ${r.outcome}`);
      return { token: r.token.reveal(), invite: r.invite };
    },

    /** Invite and review in one go. */
    async review(storefront: StorefrontInfo, rating = 5, language: 'EN' | 'AR' = 'EN') {
      const { token, invite } = await h.invite(storefront);
      const { reviewId } = await h.submit.execute(
        new SubmitReviewCommand({ token, rating, language, comment: 'Fine' }),
      );
      return { reviewId, invite, token };
    },
  };
  return h;
}

export type Harness = ReturnType<typeof harness>;

/** The salon actor for a storefront, as a console JWT would give it. */
export const salonOf = (s: StorefrontInfo, actorId = uuidv7()) => ({
  tenantId: s.tenantId,
  branchId: s.branchId,
  actorId,
});

export async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return (e as { code?: string }).code ?? (e instanceof Error ? e.message : String(e));
  }
}

export const NOTE = 'Checked against the booking record and the salon note.';
