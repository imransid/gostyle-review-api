import { DomainError } from '../domain.error';
import { isUuid } from '../shared/uuidv7';

/** The two systems that mint booking ids. Part of every booking key. */
export const BOOKING_SOURCES = ['platform', 'booking_api'] as const;
export type BookingSource = (typeof BOOKING_SOURCES)[number];

/**
 * Which booking, in which system. Two systems mint booking ids now, so an id
 * alone does not say which booking it is: (source, id) does.
 */
export class BookingRef {
  private constructor(
    readonly source: BookingSource,
    readonly id: string,
  ) {}

  static of(source: unknown, id: unknown): BookingRef {
    if (!(BOOKING_SOURCES as readonly unknown[]).includes(source)) {
      throw DomainError.validation([
        {
          field: 'bookingSource',
          code: 'UNKNOWN_VALUE',
          message: `bookingSource must be one of: ${BOOKING_SOURCES.join(', ')}.`,
        },
      ]);
    }
    if (!isUuid(id)) {
      throw DomainError.validation([
        { field: 'bookingId', code: 'INVALID_FORMAT', message: 'bookingId must be a uuid.' },
      ]);
    }
    return new BookingRef(source as BookingSource, id.toLowerCase());
  }

  equals(other: BookingRef): boolean {
    return this.source === other.source && this.id === other.id;
  }
}
