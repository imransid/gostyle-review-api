import type { BookingSource } from '../value-objects/booking-ref';

export const PUSH_SENDER = Symbol('PUSH_SENDER');

export interface PushMessage {
  userId: string;
  /** The push service sends at most once per eventId: review:<id>:reply. */
  eventId: string;
  title: string;
  body: string;
  data: Record<string, string>;
}

export type PushOutcome =
  | { kind: 'sent' }
  | { kind: 'skipped'; reason: string }
  | { kind: 'failed'; error: string }
  | { kind: 'retry'; error: string };

/** push-notification-service's POST /notifications/user. Never throws. */
export interface PushSender {
  send(message: PushMessage): Promise<PushOutcome>;
}

export const PUSH_RECIPIENTS = Symbol('PUSH_RECIPIENTS');

/**
 * Which push user a review's customer is, or null when that cannot be known.
 *
 * Null is a SKIP, not a failure: the customer-api account <-> platform
 * customer_id mapping is an open question (plan §9), so a platform booking's
 * customer often has no resolvable push user yet.
 */
export interface PushRecipients {
  userFor(input: { bookingSource: BookingSource; customerId: string | null }): Promise<string | null>;
}
