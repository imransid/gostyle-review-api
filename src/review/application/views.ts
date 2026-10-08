import type { Reply } from '../domain/review/reply.entity';
import type { ReportStatus } from '../domain/services/review-report-rules';
import type { ReviewState } from '../domain/review/review-state';

/**
 * A reply as every surface serves it (the platform's ReviewReplyView).
 * NO AUTHOR: a customer is owed an answer from the business, not the name of
 * whichever receptionist typed it.
 */
export interface ReviewReplyView {
  reviewId: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
}

export function toReplyView(reviewId: string, r: Reply): ReviewReplyView {
  return {
    reviewId,
    body: r.body,
    createdAt: r.createdAt.toISOString(),
    editedAt: r.editedAt?.toISOString() ?? null,
  };
}

/** The platform's ReviewReportFiledView. reviewState is the review's REAL state. */
export interface ReviewReportFiledView {
  reportId: string;
  reviewId: string;
  status: ReportStatus;
  reviewState: ReviewState;
}

/** The platform's ReportDecisionView, including the review's resulting state. */
export interface ReportDecisionView {
  id: string;
  tenantId: string;
  reviewId: string;
  status: ReportStatus;
  resolvedById: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  reviewState: ReviewState;
}

/** What HQ gets back after hide / restore / remove. */
export interface ModerationView {
  reviewId: string;
  state: ReviewState;
  moderatedById: string;
  moderatedAt: string;
  moderationNote: string;
}
