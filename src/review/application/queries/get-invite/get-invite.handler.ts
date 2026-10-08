import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { PrismaService } from '../../../../shared/prisma/prisma.service';
import { DomainError } from '../../../domain/domain.error';
import { refuseInvite } from '../../../domain/services/review-invite-rules';
import { InviteToken } from '../../../domain/value-objects/invite-token';
import { GetInviteQuery } from './get-invite.query';

export interface InviteView {
  /** OPEN can be submitted; USED and EXPIRED explain why the form is closed. */
  status: 'OPEN' | 'USED' | 'EXPIRED';
  salonName: string | null;
  storefrontId: string;
  expiresAt: string;
}

/**
 * What the review form shows before the customer writes anything: whose salon
 * this is, and whether the link still works. Nothing personal: no customer,
 * no booking. A token nobody minted is a 404 like on submit.
 */
@QueryHandler(GetInviteQuery)
export class GetInviteHandler implements IQueryHandler<GetInviteQuery, InviteView> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(q: GetInviteQuery): Promise<InviteView> {
    const row = await this.prisma.reviewInvite.findUnique({
      where: { tokenHash: InviteToken.hashOf(q.token) },
      select: { storefrontId: true, salonName: true, expiresAt: true, usedAt: true },
    });
    if (!row) throw new DomainError('INVITE_NOT_FOUND');
    const refusal = refuseInvite({ expiresAt: row.expiresAt, usedAt: row.usedAt }, new Date());
    return {
      status: refusal === 'INVITE_ALREADY_USED' ? 'USED' : refusal === 'INVITE_EXPIRED' ? 'EXPIRED' : 'OPEN',
      salonName: row.salonName,
      storefrontId: row.storefrontId,
      expiresAt: row.expiresAt.toISOString(),
    };
  }
}
