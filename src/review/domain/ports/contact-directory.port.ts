import type { BookingSource } from '../value-objects/booking-ref';

export const CONTACT_DIRECTORY = Symbol('CONTACT_DIRECTORY');

/** A customer reduced to the two facts the review flow needs. */
export interface Contact {
  /** Null when the record has no usable number. */
  phone: string | null;
  /** Null when there is no name on file. */
  displayName: string | null;
}

/**
 * Who the customer is, asked at the moment it is needed and never stored:
 * the PHONE at send time (a number dialled three weeks later may have
 * changed), the NAME at review-write time (copied onto the review then).
 *
 * Null means "no contact": unknown id, no customer (a walk-in), or a booking
 * system whose contact owner is not decided yet (see docs/DECISIONS.md).
 * Throws DependencyUnavailableError when the owner cannot be reached, so a
 * caller can fail and retry instead of acting on a guess.
 */
export interface ContactDirectory {
  find(input: { bookingSource: BookingSource; customerId: string | null }): Promise<Contact | null>;
}

/** The owner of a fact could not be asked. Never a reason to guess. */
export class DependencyUnavailableError extends Error {
  constructor(readonly dependency: string, message: string) {
    super(message);
    this.name = 'DependencyUnavailableError';
  }
}
