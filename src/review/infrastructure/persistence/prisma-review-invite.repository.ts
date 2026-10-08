import { Injectable } from '@nestjs/common';
import type { ReviewInvite as Row } from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { asPrisma } from '../../../shared/prisma/prisma-tx';
import { ReviewInvite } from '../../domain/invite/review-invite.aggregate';
import type { ReviewInviteRepository } from '../../domain/ports/review-invite.repository';
import type { TxHandle } from '../../domain/ports/unit-of-work.port';
import { BookingRef } from '../../domain/value-objects/booking-ref';
import { SubjectRef } from '../../domain/value-objects/subject-ref';

export function toInvite(r: Row): ReviewInvite {
  return ReviewInvite.restore({
    id: r.id,
    subject: SubjectRef.of({ tenantId: r.tenantId, storefrontId: r.storefrontId, branchId: r.branchId }),
    booking: BookingRef.of(r.bookingSource, r.bookingId),
    tokenHash: r.tokenHash,
    expiresAt: r.expiresAt,
    usedAt: r.usedAt,
    customerId: r.customerId,
    salonName: r.salonName,
    storefrontSlug: r.storefrontSlug,
    locale: r.locale,
    sendStatus: r.sendStatus,
    sendAttempts: r.sendAttempts,
    sentAt: r.sentAt,
    lastSendError: r.lastSendError,
    createdAt: r.createdAt,
  });
}

@Injectable()
export class PrismaReviewInviteRepository implements ReviewInviteRepository {
  constructor(private readonly prisma: PrismaService) {}

  async insertIfAbsent(invite: ReviewInvite, tx?: TxHandle): Promise<boolean> {
    // ON CONFLICT on the BOOKING KEY only. A conflict on anything else (the
    // token hash, the id) is a real error and must not read as "already
    // invited".
    const inserted = await asPrisma(this.prisma, tx).$executeRaw`
      INSERT INTO review_invite (
        id, tenant_id, storefront_id, branch_id, booking_source, booking_id,
        token_hash, expires_at, customer_id, salon_name, storefront_slug, locale,
        send_status, created_at)
      VALUES (
        ${invite.id}::uuid, ${invite.subject.tenantId}::uuid,
        ${invite.subject.storefrontId}::uuid, ${invite.subject.branchId}::uuid,
        ${invite.booking.source}::booking_source, ${invite.booking.id}::uuid,
        ${invite.tokenHash}, ${invite.expiresAt}, ${invite.customerId}::uuid,
        ${invite.salonName}, ${invite.storefrontSlug}, ${invite.locale},
        'PENDING'::invite_send_status, ${invite.createdAt})
      ON CONFLICT (booking_source, booking_id) DO NOTHING`;
    return inserted === 1;
  }

  async findByTokenHash(tokenHash: string, tx?: TxHandle): Promise<ReviewInvite | null> {
    const r = await asPrisma(this.prisma, tx).reviewInvite.findUnique({ where: { tokenHash } });
    return r ? toInvite(r) : null;
  }

  async findById(id: string, tx?: TxHandle): Promise<ReviewInvite | null> {
    const r = await asPrisma(this.prisma, tx).reviewInvite.findUnique({ where: { id } });
    return r ? toInvite(r) : null;
  }

  async markUsed(id: string, now: Date, tx?: TxHandle): Promise<boolean> {
    // THE SINGLE-USE GUARANTEE is this WHERE: still unused and unexpired at
    // the moment of the write. Of two concurrent redemptions, one flips the row
    // and the other sees count 0.
    const { count } = await asPrisma(this.prisma, tx).reviewInvite.updateMany({
      where: { id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    return count === 1;
  }

  async saveSendState(invite: ReviewInvite, tx?: TxHandle): Promise<void> {
    // SENT is terminal in the database too: a late write from a retry that
    // lost a race cannot turn a sent invite back into anything else.
    await asPrisma(this.prisma, tx).reviewInvite.updateMany({
      where: { id: invite.id, sendStatus: { not: 'SENT' } },
      data: {
        sendStatus: invite.sendStatus,
        sendAttempts: invite.sendAttempts,
        sentAt: invite.sentAt,
        lastSendError: invite.lastSendError,
      },
    });
  }

  async saveRotatedToken(invite: ReviewInvite, tx?: TxHandle): Promise<boolean> {
    const { count } = await asPrisma(this.prisma, tx).reviewInvite.updateMany({
      where: { id: invite.id, sendStatus: 'RETRYING', usedAt: null },
      data: { tokenHash: invite.tokenHash },
    });
    return count === 1;
  }

  async eraseCustomer(customerId: string, tenantId: string | null, tx?: TxHandle): Promise<number> {
    const { count } = await asPrisma(this.prisma, tx).reviewInvite.updateMany({
      where: { customerId, ...(tenantId ? { tenantId } : {}) },
      data: { customerId: null },
    });
    return count;
  }
}
