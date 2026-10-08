import { Injectable } from '@nestjs/common';
import { AppConfig } from '../../../shared/config/app-config';
import type { PushMessage, PushOutcome, PushSender } from '../../domain/ports/push-sender.port';

const TIMEOUT_MS = 3_000;

/**
 * push-notification-service's POST /notifications/user, as booking-api's
 * push-notification.client.ts calls it.
 *
 * ONE attempt per call: the caller is the outbox relay, which retries with
 * backoff. Safe to call twice for one eventId: the push service keeps
 * (user, event, device) unique and sends at most once.
 *
 *   202 with devices>0  sent
 *   202 with devices=0  skipped (the user has no devices; push records nothing)
 *   other 4xx           failed  (the request is wrong; retrying won't help)
 *   5xx / timeout / refused  retry
 */
@Injectable()
export class PushNotificationClient implements PushSender {
  constructor(private readonly config: AppConfig) {}

  async send(message: PushMessage): Promise<PushOutcome> {
    let res: Response;
    try {
      res = await fetch(`${this.config.push.url}/notifications/user`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': this.config.push.key },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      return { kind: 'retry', error: `push service unreachable (${e instanceof Error ? e.name : 'error'})` };
    }
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as { devices?: unknown } | null;
      return body?.devices === 0 ? { kind: 'skipped', reason: 'no_devices' } : { kind: 'sent' };
    }
    if (res.status >= 500) return { kind: 'retry', error: `push service HTTP ${res.status}` };
    return { kind: 'failed', error: `push service HTTP ${res.status}` };
  }
}
