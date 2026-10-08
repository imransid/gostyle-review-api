import { VISIBLE_REVIEW_STATES, type ReviewState } from '../services/review-rules';

export type { ReviewState };

/**
 * The review's lifecycle.
 *
 *   PUBLISHED <-> HIDDEN     a moderator hides, or restores
 *   PUBLISHED  -> REMOVED    final
 *   HIDDEN     -> REMOVED    final
 *
 * REMOVED has no way out, and no way back to a second review either: the row
 * still holds its booking, so UNIQUE (booking_source, booking_id) refuses a
 * replacement.
 */
export const REVIEW_TRANSITIONS: Readonly<Record<ReviewState, readonly ReviewState[]>> = {
  PUBLISHED: ['HIDDEN', 'REMOVED'],
  HIDDEN: ['PUBLISHED', 'REMOVED'],
  REMOVED: [],
};

export function canTransition(from: ReviewState, to: ReviewState): boolean {
  return REVIEW_TRANSITIONS[from].includes(to);
}

/** Shown on the public page and counted in the rating. PUBLISHED only. */
export function isVisible(state: ReviewState): boolean {
  return VISIBLE_REVIEW_STATES.includes(state);
}
