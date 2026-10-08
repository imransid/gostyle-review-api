import type { BookingSource } from '../../../domain/value-objects/booking-ref';

export class CreateReviewInviteCommand {
  constructor(
    public readonly input: {
      /** Which booking system completed the booking. */
      bookingSource: BookingSource;
      bookingId: string;
      branchId: string;
      /**
       * The tenant the EVENT names, when it names one. Checked against the
       * storefront's owner, never used as a fallback, never defaulted.
       */
      tenantId: string | null;
      /** Whose booking; null for a walk-in. The name and phone are read later. */
      customerId: string | null;
      /** When called by an event consumer: written FIRST, in the same transaction. */
      inbox?: { source: string; eventId: string; eventType: string };
    },
  ) {}
}
