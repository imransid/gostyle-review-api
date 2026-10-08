import { Injectable } from '@nestjs/common';
import type { PushRecipients } from '../../domain/ports/push-sender.port';
import type { BookingSource } from '../../domain/value-objects/booking-ref';

/**
 * Which push user a review's customer is.
 *
 * booking_api: the booking's customer id IS the customer-api account, and it
 * is what booking-api's own PushListener sends to. Known.
 *
 * platform: a platform customer_id is per salon, and how it maps to a
 * customer-api account is an OPEN QUESTION (plan §9). Null: the reply push is
 * skipped and logged, never failed (docs/DECISIONS.md).
 */
@Injectable()
export class BookingSourcePushRecipients implements PushRecipients {
  async userFor(input: { bookingSource: BookingSource; customerId: string | null }): Promise<string | null> {
    if (input.customerId === null) return null;
    return input.bookingSource === 'booking_api' ? input.customerId : null;
  }
}
