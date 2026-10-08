import { FieldError } from './field-error';

// ──────────────────────────────────────────────────────────────────────
// The salon's right of reply.
//
// Pure. No Prisma, no Nest, no clock.
//
// ONE REPLY PER REVIEW, NOT A THREAD. A public page is not a conversation: a
// thread invites an argument in front of customers, and the second round is
// never the one that reads well. The salon gets the last word once.
//
// HARD DELETE, no state and no deletedAt. A reply is the salon's own words on
// its own page, so withdrawing them is not moderation and leaves nothing to
// audit — unlike a REVIEW, which is somebody else's words and can only ever be
// hidden. That asymmetry is the whole reason these are two tables.
// ──────────────────────────────────────────────────────────────────────

/**
 * How long a reply may be.
 *
 * Longer than a review's comment on purpose. A salon answering a specific
 * complaint needs room to address it — "we refunded this and retrained the
 * stylist" is longer than the sentence that prompted it — and unlike the
 * review, this text is written by an authenticated console user whose account
 * is known, so the surface-area argument that caps the review does not apply.
 */
export const REPLY_MAX = 1500;

const err = (field: string, code: FieldError['code'], message: string): FieldError => ({
  field,
  code,
  message,
});

export interface ReplySubmission {
  body: string;
}

export interface ReplySubmissionValidation {
  errors: FieldError[];
  normalized: ReplySubmission;
}

/**
 * Validate a reply.
 *
 * REQUIRED AND NON-EMPTY. An empty reply is not a reply — it is a delete, and
 * delete is its own endpoint. Collapsing the two would make "the salon has
 * responded" unanswerable from the row, which is the one thing a customer
 * reading the page wants to know.
 *
 * Never throws.
 */
export function checkReplySubmission(input: unknown): ReplySubmissionValidation {
  const errors: FieldError[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;

  let body = '';
  if (typeof raw.body !== 'string') {
    errors.push(err('body', 'REQUIRED', 'A reply is required.'));
  } else {
    body = raw.body.trim();
    if (body.length === 0) {
      errors.push(
        err(
          'body',
          'REQUIRED',
          'A reply cannot be empty. Delete the reply instead of blanking it.',
        ),
      );
    } else if (body.length > REPLY_MAX) {
      errors.push(err('body', 'TOO_LONG', `A reply must be at most ${REPLY_MAX} characters.`));
    }
  }

  return { errors, normalized: { body } };
}

/** Errors only. Empty array means the reply is well formed. */
export function validateReplySubmission(input: unknown): FieldError[] {
  return checkReplySubmission(input).errors;
}
