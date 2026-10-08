import { Injectable } from '@nestjs/common';
import { AppConfig } from '../../../shared/config/app-config';
import type { EventDestination, RelayedEvent } from '../../../shared/outbox/event-destination';
import { RATING_SUMMARY_CHANGED } from '../../application/rating/rating-projector';

const TIMEOUT_MS = 5_000;

/**
 * rating.summary.changed.v1 -> customer-api's local rating table.
 *
 * POST /internal/review-events/ with review-service's own key. customer-api
 * dedupes by event id and keeps the highest `version`, so a redelivery, or an
 * older event arriving after a newer one, changes nothing. Any non-2xx throws
 * and the relay retries with backoff.
 */
@Injectable()
export class CustomerApiRatingSink implements EventDestination {
  readonly name = 'customer-api';
  readonly eventTypes = [RATING_SUMMARY_CHANGED];

  constructor(private readonly config: AppConfig) {}

  async deliver(e: RelayedEvent): Promise<void> {
    let res: Response;
    try {
      res = await fetch(`${this.config.customerApi.url}/internal/review-events/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-service-key': this.config.customerApi.key },
        body: JSON.stringify({
          id: e.id,
          type: e.eventType,
          occurredAt: e.createdAt.toISOString(),
          payload: e.payload,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new Error(`customer-api unreachable (${err instanceof Error ? err.name : 'error'})`);
    }
    if (!res.ok) throw new Error(`customer-api answered HTTP ${res.status}`);
  }
}
