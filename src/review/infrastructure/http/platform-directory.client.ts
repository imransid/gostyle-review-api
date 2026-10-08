import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../../../shared/config/app-config';
import type { Contact, ContactDirectory } from '../../domain/ports/contact-directory.port';
import type {
  StorefrontDirectory,
  StorefrontInfo,
} from '../../domain/ports/storefront-directory.port';
import { isUuid } from '../../domain/shared/uuidv7';
import type { BookingSource } from '../../domain/value-objects/booking-ref';
import { getJson } from './http-json';

const PLATFORM = 'gostyle-platform';

/**
 * gostyle-platform's internal review-service routes, behind the storefront
 * and contact ports. Authenticated with this service's own key
 * (PLATFORM_INTERNAL_KEY), never a shared one.
 *
 *   GET /internal/review-service/storefronts/by-branch/:branchId
 *   GET /internal/review-service/customers/:customerId/contact
 */
@Injectable()
export class PlatformDirectoryClient implements StorefrontDirectory, ContactDirectory {
  private static readonly log = new Logger(PlatformDirectoryClient.name);

  constructor(private readonly config: AppConfig) {}

  private headers() {
    return { accept: 'application/json', 'x-service-key': this.config.platform.internalKey };
  }

  async findByBranch(branchId: string): Promise<StorefrontInfo | null> {
    if (!isUuid(branchId)) return null;
    const body = await getJson<StorefrontInfo>(
      PLATFORM,
      `${this.config.platform.apiUrl}/internal/review-service/storefronts/by-branch/${branchId}`,
      this.headers(),
      this.config.httpTimeoutMs,
    );
    if (body === null) return null;
    if (!isUuid(body.storefrontId) || !isUuid(body.tenantId) || !isUuid(body.branchId)) {
      PlatformDirectoryClient.log.error(`storefront lookup for branch ${branchId} returned a malformed body`);
      return null;
    }
    return body;
  }

  /**
   * The contact for a booking's customer. Only PLATFORM bookings have a known
   * owner: booking-api bookings carry a customer-api account id, and who
   * answers for those is open (plan §9, docs/DECISIONS.md). Null there is "no
   * contact", which means no WhatsApp send and the reviewer may type a name.
   */
  async find(input: { bookingSource: BookingSource; customerId: string | null }): Promise<Contact | null> {
    if (input.customerId === null || !isUuid(input.customerId)) return null;
    if (input.bookingSource !== 'platform') return null;
    const body = await getJson<{ displayName?: unknown; phone?: unknown }>(
      PLATFORM,
      `${this.config.platform.apiUrl}/internal/review-service/customers/${input.customerId}/contact`,
      this.headers(),
      this.config.httpTimeoutMs,
    );
    if (body === null) return null;
    const text = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
    return { displayName: text(body.displayName), phone: text(body.phone) };
  }
}
