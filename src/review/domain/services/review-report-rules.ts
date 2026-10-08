import { FieldError } from './field-error';

// ──────────────────────────────────────────────────────────────────────
// Reporting a review: what a salon may claim, and who may decide it.
//
// Pure. No Prisma, no Nest, no clock.
//
// THE POINT OF THIS FILE IS THAT REPORTING IS NOT MODERATION. A salon files a
// report; HQ decides it. Nothing here lets the reporting party change what the
// public sees, because a system where complaining hides the complaint is a
// system for suppressing criticism rather than correcting error.
// ──────────────────────────────────────────────────────────────────────

/**
 * Why a salon says a review should not stand.
 *
 * A CLOSED SET, and every member is a claim about the review's VALIDITY rather
 * than about its sentiment. There is deliberately no "unfair", "inaccurate" or
 * "we disagree": a one-star review from a real customer who had a bad time is
 * exactly the review this system exists to publish, and giving that feeling a
 * button would turn the queue into a complaints desk for bad ratings.
 *
 * Each of these is checkable by somebody who was not there — which is what
 * makes an HQ queue able to decide them at all.
 */
export const REPORT_REASONS = [
  /** The reviewer has us confused with another branch or another business. */
  'WRONG_BRANCH_OR_BUSINESS',
  /** Not about the visit: advertising, nonsense, a copy-paste. */
  'OFF_TOPIC_OR_SPAM',
  /** Abuse, threats, or targeting a named member of staff. */
  'HARASSMENT',
  /** Written to push a competitor's offer. */
  'COMPETITOR_PROMOTION',
  /** No visit we can find matches this. The fraud claim. */
  'FAKE_NO_VISIT',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/**
 * Where a report is, which is NOT where the review is.
 *
 * The review has its own state — PUBLISHED, HIDDEN, REMOVED — and it says what
 * the public sees. This says whether anybody has finished thinking about the
 * complaint. Keeping them apart is what makes "a report does not hide the
 * review" expressible: an OPEN report changes nothing a customer can see.
 *
 * It also kills the question before anyone answers it wrongly: there is no
 * REPORTED review state, so "does a reported review count toward the average"
 * has no way to be asked. It counts, because it is still PUBLISHED.
 */
export const REPORT_STATUSES = ['OPEN', 'UPHELD', 'DISMISSED'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** A report nobody has decided yet. The only state that blocks a second one. */
export const OPEN_REPORT_STATUS: ReportStatus = 'OPEN';

/**
 * The SALON's moves on a report: none.
 *
 * An empty map, and it is not an oversight — it is the same two-map split the
 * badge rules use, for the same reason. The party that filed the report must
 * not be able to resolve it, and a single map with an actor column would put
 * that one careless edit away. There is nothing to add here.
 */
export const REPORT_TRANSITIONS: Readonly<Record<ReportStatus, readonly ReportStatus[]>> = {
  OPEN: [],
  UPHELD: [],
  DISMISSED: [],
};

/**
 * The REVIEWER's moves. A separate map, checked by the platform path only.
 *
 * Both decisions are terminal. A reopen would need a new report, which is
 * exactly right: a second look at a dismissed review is a new complaint with a
 * new date, not an edit to the old one.
 */
export const REPORT_REVIEW_TRANSITIONS: Readonly<Record<ReportStatus, readonly ReportStatus[]>> = {
  OPEN: ['UPHELD', 'DISMISSED'],
  UPHELD: [],
  DISMISSED: [],
};

export function canReporterTransition(from: ReportStatus, to: ReportStatus): boolean {
  return REPORT_TRANSITIONS[from].includes(to);
}

export function canResolverTransition(from: ReportStatus, to: ReportStatus): boolean {
  return REPORT_REVIEW_TRANSITIONS[from].includes(to);
}

export const REPORT_NOTE_MIN = 10;
export const REPORT_NOTE_MAX = 500;

const err = (field: string, code: FieldError['code'], message: string): FieldError => ({
  field,
  code,
  message,
});

export interface ReportSubmission {
  reason: ReportReason;
  /** Trimmed. Null when the salon added nothing beyond the reason. */
  note: string | null;
}

export interface ReportSubmissionValidation {
  errors: FieldError[];
  normalized: ReportSubmission;
}

/**
 * Validate a salon's report.
 *
 * The NOTE IS OPTIONAL here, unlike the reviewer's resolution note below, and
 * the asymmetry is deliberate: the reason is already a closed claim a reviewer
 * can act on, so demanding prose would only produce "see above". A reviewer
 * turning a report down is refusing somebody, which is the case that always
 * needs words.
 *
 * Never throws, matching every other check* in this package.
 */
export function checkReportSubmission(input: unknown): ReportSubmissionValidation {
  const errors: FieldError[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;

  const reason = raw.reason as ReportReason;
  if (!(REPORT_REASONS as readonly string[]).includes(reason)) {
    errors.push(
      err('reason', 'UNKNOWN_VALUE', `reason must be one of: ${REPORT_REASONS.join(', ')}.`),
    );
  }

  let note: string | null = null;
  if (raw.note !== undefined && raw.note !== null) {
    if (typeof raw.note !== 'string') {
      errors.push(err('note', 'INVALID_FORMAT', 'The note must be text.'));
    } else {
      const trimmed = raw.note.trim();
      if (trimmed.length > REPORT_NOTE_MAX) {
        errors.push(
          err('note', 'TOO_LONG', `The note must be at most ${REPORT_NOTE_MAX} characters.`),
        );
      }
      note = trimmed.length > 0 ? trimmed : null;
    }
  }

  return { errors, normalized: { reason, note } };
}

/**
 * A resolution has to say why, whichever way it went.
 *
 * REQUIRED ON BOTH OUTCOMES, not just on dismissal. An upheld report hides a
 * real customer's words, and "why was this taken down" must have an answer
 * written by the person who took it down — the same argument validateReviewNote
 * makes about a rejected badge, applied to the side with more at stake.
 */
export function validateResolutionNote(note: unknown): FieldError[] {
  if (typeof note !== 'string') {
    return [err('note', 'REQUIRED', 'A reason is required when resolving a report.')];
  }
  const trimmed = note.trim();
  if (trimmed.length === 0) {
    return [err('note', 'REQUIRED', 'A reason is required when resolving a report.')];
  }
  if (trimmed.length < REPORT_NOTE_MIN) {
    return [
      err(
        'note',
        'OUT_OF_RANGE',
        `The reason must be at least ${REPORT_NOTE_MIN} characters, so the salon can act on it.`,
      ),
    ];
  }
  if (trimmed.length > REPORT_NOTE_MAX) {
    return [err('note', 'TOO_LONG', `The reason must be at most ${REPORT_NOTE_MAX} characters.`)];
  }
  return [];
}
