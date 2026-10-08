import { CommandBus } from '@nestjs/cqrs';
import { CreateReviewInviteCommand } from '../../src/review/application/commands/create-review-invite/create-review-invite.command';
import type { StorefrontInfo } from '../../src/review/domain/ports/storefront-directory.port';
import { uuidv7 } from '../../src/review/domain/shared/uuidv7';
import { platformToken } from '../support/tokens';
import { JWT_SECRET, type E2E } from './app';

let ipCounter = 0;
/** A fresh client IP per call, so seeding never trips the submit throttle. */
export const freshIp = () => {
  ipCounter += 1;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
};

export function storefront(e: E2E, over: Partial<StorefrontInfo> = {}): StorefrontInfo {
  const s: StorefrontInfo = {
    storefrontId: uuidv7(),
    tenantId: uuidv7(),
    branchId: uuidv7(),
    salonName: 'Marina Walk',
    slug: 'marina-walk',
    locale: 'en',
    ...over,
  };
  e.platform.storefronts.set(s.branchId, s);
  return s;
}

export async function invite(
  e: E2E,
  s: StorefrontInfo,
  over: { customerId?: string | null; bookingSource?: 'platform' | 'booking_api' } = {},
) {
  const r = await e.app.get(CommandBus).execute(
    new CreateReviewInviteCommand({
      bookingSource: over.bookingSource ?? 'platform',
      bookingId: uuidv7(),
      branchId: s.branchId,
      tenantId: s.tenantId,
      customerId: over.customerId === undefined ? uuidv7() : over.customerId,
    }),
  );
  if (!r.token) throw new Error(`no invite: ${r.outcome}`);
  return { token: r.token.reveal() as string, inviteId: r.invite.id as string };
}

export async function review(
  e: E2E,
  s: StorefrontInfo,
  body: Record<string, unknown> = { rating: 5, language: 'EN' },
): Promise<string> {
  const { token } = await invite(e, s);
  const res = await e.http().post(`/v1/public/reviews/${token}`).set('x-forwarded-for', freshIp()).send(body);
  if (res.status !== 201) throw new Error(`submit failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.reviewId;
}

/** A salon staff token for `s`, with these permission codes on the platform. */
export function staff(e: E2E, s: StorefrontInfo, perms: string[], over: Record<string, unknown> = {}) {
  const sub = uuidv7();
  e.platform.perms.set(sub, perms);
  return {
    sub,
    auth: `Bearer ${platformToken(JWT_SECRET, { sub, tenantId: s.tenantId, branchId: s.branchId, actor: 'tenant_user', ...over })}`,
  };
}

/** An HQ token: platform_admin actor, no tenant. */
export function hq(e: E2E, perms = ['storefront.review_moderation'], actor = 'platform_admin') {
  const sub = uuidv7();
  e.platform.perms.set(sub, perms);
  return { sub, auth: `Bearer ${platformToken(JWT_SECRET, { sub, actor })}` };
}

export const ALL_STAFF = ['storefront-edit.read', 'marketing-reviews.update', 'marketing-reviews.create'];
export const NOTE = 'Checked against the booking record and the salon note.';
