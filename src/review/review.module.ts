import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { EVENT_DESTINATIONS, type EventDestination } from '../shared/outbox/event-destination';
import { INBOX, OUTBOX_WRITER } from '../shared/outbox/outbox.port';
import { OutboxRelay } from '../shared/outbox/outbox-relay';
import {
  OUTBOX_QUEUE,
  OutboxRelayProcessor,
  OutboxRelayScheduler,
} from '../shared/outbox/outbox-relay.processor';
import { PrismaInbox, PrismaOutboxWriter } from '../shared/outbox/prisma-outbox';
import { PrismaUnitOfWork } from '../shared/prisma/prisma-tx';
import { HttpPermissionResolver, PERMISSION_RESOLVER } from '../shared/auth/permission-resolver';
import { PlatformJwtGuard } from '../shared/auth/platform-jwt.guard';
import { ServiceKeyGuard } from '../shared/auth/service-key.guard';
import { JOBS_QUEUE, ReviewJobsProcessor, ReviewJobsScheduler } from './application/jobs/review-jobs';
import { GetInviteHandler } from './application/queries/get-invite/get-invite.handler';
import {
  GetConsoleAggregateHandler,
  GetRatingSummariesHandler,
} from './application/queries/get-rating-summary/get-rating-summary.handlers';
import { ListConsoleReviewsHandler } from './application/queries/list-console-reviews/list-console-reviews.handler';
import { ListPublicReviewsHandler } from './application/queries/list-public-reviews/list-public-reviews.handler';
import { GetReportHandler, ListReportQueueHandler } from './application/queries/report-queue/report-queue.handlers';
import { ConsoleReviewsController } from './presentation/console-reviews.controller';
import { InternalController } from './presentation/internal.controller';
import { ReviewModerationController, ReviewReportsController } from './presentation/moderation.controller';
import { PublicReviewsController } from './presentation/public-reviews.controller';
import { CLOCK, systemClock } from './application/clock';
import { CreateReviewInviteHandler } from './application/commands/create-review-invite/create-review-invite.handler';
import { DeleteReplyHandler } from './application/commands/delete-reply/delete-reply.handler';
import { DismissReportHandler } from './application/commands/dismiss-report/dismiss-report.handler';
import { EditReplyHandler } from './application/commands/edit-reply/edit-reply.handler';
import { EraseCustomerReviewsHandler } from './application/commands/erase-customer-reviews/erase-customer-reviews.handler';
import {
  HideReviewHandler,
  RemoveReviewHandler,
  RestoreReviewHandler,
} from './application/commands/moderate-review/moderate-review.handlers';
import { PostReplyHandler } from './application/commands/post-reply/post-reply.handler';
import { RecomputeRatingSummariesHandler } from './application/commands/recompute-rating-summaries/recompute-rating-summaries.handler';
import { ReportReviewHandler } from './application/commands/report-review/report-review.handler';
import { SubmitReviewHandler } from './application/commands/submit-review/submit-review.handler';
import { UpholdReportHandler } from './application/commands/uphold-report/uphold-report.handler';
import { RatingProjector } from './application/rating/rating-projector';
import { CONTACT_DIRECTORY } from './domain/ports/contact-directory.port';
import { RATING_SUMMARY_REPOSITORY } from './domain/ports/rating-summary.repository';
import { REVIEW_INVITE_REPOSITORY } from './domain/ports/review-invite.repository';
import { REVIEW_REPORT_REPOSITORY } from './domain/ports/review-report.repository';
import { REVIEW_REPOSITORY } from './domain/ports/review.repository';
import { STOREFRONT_DIRECTORY } from './domain/ports/storefront-directory.port';
import { UNIT_OF_WORK } from './domain/ports/unit-of-work.port';
import { PlatformDirectoryClient } from './infrastructure/http/platform-directory.client';
import { AppConfig } from '../shared/config/app-config';
import { BookingCompletedConsumer } from './application/consumers/booking-completed.consumer';
import { ReplyPushHandler } from './application/event-handlers/reply-push.handler';
import { InviteDelivery } from './application/invites/invite-delivery';
import { INVITE_SENDER } from './domain/ports/invite-sender.port';
import { PUSH_RECIPIENTS, PUSH_SENDER } from './domain/ports/push-sender.port';
import { CustomerApiRatingSink } from './infrastructure/http/customer-api-rating.sink';
import { PushNotificationClient } from './infrastructure/http/push-notification.client';
import { BookingSourcePushRecipients } from './infrastructure/http/push-recipients';
import { LogInviteSender, LogLinkInviteSender } from './infrastructure/senders/log-invite-sender';
import { WhatsAppInviteSender } from './infrastructure/senders/whatsapp-invite-sender';
import { PrismaRatingSummaryRepository } from './infrastructure/persistence/prisma-rating-summary.repository';
import { PrismaReviewInviteRepository } from './infrastructure/persistence/prisma-review-invite.repository';
import { PrismaReviewReportRepository } from './infrastructure/persistence/prisma-review-report.repository';
import { PrismaReviewRepository } from './infrastructure/persistence/prisma-review.repository';

const COMMAND_HANDLERS = [
  CreateReviewInviteHandler,
  SubmitReviewHandler,
  PostReplyHandler,
  EditReplyHandler,
  DeleteReplyHandler,
  ReportReviewHandler,
  UpholdReportHandler,
  DismissReportHandler,
  HideReviewHandler,
  RestoreReviewHandler,
  RemoveReviewHandler,
  RecomputeRatingSummariesHandler,
  EraseCustomerReviewsHandler,
];

const QUERY_HANDLERS = [
  GetInviteHandler,
  ListPublicReviewsHandler,
  GetRatingSummariesHandler,
  ListConsoleReviewsHandler,
  GetConsoleAggregateHandler,
  ListReportQueueHandler,
  GetReportHandler,
];

/**
 * Every port is bound HERE and nowhere else: swapping an adapter is one line.
 * Application code receives ports by Symbol and never imports infrastructure/.
 */
@Module({
  imports: [
    CqrsModule,
    BullModule.registerQueue({ name: OUTBOX_QUEUE }, { name: JOBS_QUEUE }),
  ],
  controllers: [
    PublicReviewsController,
    ConsoleReviewsController,
    ReviewReportsController,
    ReviewModerationController,
    InternalController,
  ],
  providers: [
    ...COMMAND_HANDLERS,
    ...QUERY_HANDLERS,
    PlatformJwtGuard,
    ServiceKeyGuard,
    { provide: PERMISSION_RESOLVER, useClass: HttpPermissionResolver },
    ReviewJobsProcessor,
    ReviewJobsScheduler,
    RatingProjector,
    { provide: CLOCK, useValue: systemClock },
    { provide: UNIT_OF_WORK, useClass: PrismaUnitOfWork },
    { provide: OUTBOX_WRITER, useClass: PrismaOutboxWriter },
    { provide: INBOX, useClass: PrismaInbox },
    { provide: REVIEW_REPOSITORY, useClass: PrismaReviewRepository },
    { provide: REVIEW_INVITE_REPOSITORY, useClass: PrismaReviewInviteRepository },
    { provide: REVIEW_REPORT_REPOSITORY, useClass: PrismaReviewReportRepository },
    { provide: RATING_SUMMARY_REPOSITORY, useClass: PrismaRatingSummaryRepository },
    PlatformDirectoryClient,
    { provide: STOREFRONT_DIRECTORY, useExisting: PlatformDirectoryClient },
    { provide: CONTACT_DIRECTORY, useExisting: PlatformDirectoryClient },
    // The invite channel: INVITE_SENDER=log in development, whatsapp in
    // production, log_link for manual testing (never in production).
    LogInviteSender,
    LogLinkInviteSender,
    WhatsAppInviteSender,
    {
      provide: INVITE_SENDER,
      inject: [AppConfig, LogInviteSender, LogLinkInviteSender, WhatsAppInviteSender],
      useFactory: (config: AppConfig, log: LogInviteSender, logLink: LogLinkInviteSender, wa: WhatsAppInviteSender) =>
        config.inviteSender === 'whatsapp' ? wa : config.inviteSender === 'log_link' ? logLink : log,
    },
    { provide: PUSH_SENDER, useClass: PushNotificationClient },
    { provide: PUSH_RECIPIENTS, useClass: BookingSourcePushRecipients },
    InviteDelivery,
    BookingCompletedConsumer,
    // Where relayed events go. Each destination names the event types it takes.
    CustomerApiRatingSink,
    ReplyPushHandler,
    {
      provide: EVENT_DESTINATIONS,
      inject: [CustomerApiRatingSink, ReplyPushHandler],
      useFactory: (ratings: CustomerApiRatingSink, push: ReplyPushHandler): EventDestination[] => [ratings, push],
    },
    OutboxRelay,
    OutboxRelayProcessor,
    OutboxRelayScheduler,
  ],
})
export class ReviewModule {}
