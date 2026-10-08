import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { asPrisma, isUniqueViolation } from '../../../shared/prisma/prisma-tx';
import { DomainError } from '../../domain/domain.error';
import type { ReviewRepository } from '../../domain/ports/review.repository';
import type { TxHandle } from '../../domain/ports/unit-of-work.port';
import { Reply } from '../../domain/review/reply.entity';
import { Review } from '../../domain/review/review.aggregate';
import type { ReviewState } from '../../domain/review/review-state';
import { AuthorName } from '../../domain/value-objects/author-name';
import { BookingRef } from '../../domain/value-objects/booking-ref';
import { Comment } from '../../domain/value-objects/comment';
import { Rating } from '../../domain/value-objects/rating';
import { ReviewLanguage } from '../../domain/value-objects/review-language';
import { SubjectRef } from '../../domain/value-objects/subject-ref';

type Row = Prisma.ReviewGetPayload<{ include: { reply: true } }>;

export function toReview(r: Row): Review {
  return Review.restore({
    id: r.id,
    subject: SubjectRef.of({ tenantId: r.tenantId, storefrontId: r.storefrontId, branchId: r.branchId }),
    booking: BookingRef.of(r.bookingSource, r.bookingId),
    inviteId: r.inviteId,
    customerId: r.customerId,
    rating: Rating.of(r.rating),
    comment: Comment.of(r.comment),
    language: ReviewLanguage.of(r.language),
    authorName: AuthorName.of(r.authorDisplayName),
    state: r.state,
    moderation:
      r.moderatedById && r.moderatedAt
        ? { byId: r.moderatedById, at: r.moderatedAt, note: r.moderationNote ?? '' }
        : null,
    createdAt: r.createdAt,
    reply: r.reply
      ? Reply.restore({
          id: r.reply.id,
          body: r.reply.body,
          authorId: r.reply.authorId,
          editedById: r.reply.editedById,
          editedAt: r.reply.editedAt,
          createdAt: r.reply.createdAt,
        })
      : null,
  });
}

@Injectable()
export class PrismaReviewRepository implements ReviewRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string, tx?: TxHandle): Promise<Review | null> {
    const r = await asPrisma(this.prisma, tx).review.findUnique({
      where: { id },
      include: { reply: true },
    });
    return r ? toReview(r) : null;
  }

  async findForSalon(
    id: string,
    salon: { tenantId: string; branchId: string },
    tx?: TxHandle,
  ): Promise<Review | null> {
    // THE OWNERSHIP CHECK IS THE WHERE. A review id is a bare uuid from a URL;
    // without tenant AND branch here, one salon could answer in another's name.
    const r = await asPrisma(this.prisma, tx).review.findFirst({
      where: { id, tenantId: salon.tenantId, branchId: salon.branchId },
      include: { reply: true },
    });
    return r ? toReview(r) : null;
  }

  async insert(review: Review, tx?: TxHandle): Promise<void> {
    try {
      await asPrisma(this.prisma, tx).review.create({
        data: {
          id: review.id,
          tenantId: review.subject.tenantId,
          storefrontId: review.subject.storefrontId,
          branchId: review.subject.branchId,
          bookingSource: review.booking.source,
          bookingId: review.booking.id,
          inviteId: review.inviteId,
          customerId: review.customerId,
          rating: review.rating.value,
          comment: review.comment.value,
          language: review.language.value,
          authorDisplayName: review.authorName.stored,
          state: review.state,
          createdAt: review.createdAt,
        },
      });
    } catch (e) {
      // One review per booking (and per invite) is the database's to enforce.
      // Reaching it means the invite's conditional update was bypassed or
      // raced; either way the honest answer is "already used".
      if (isUniqueViolation(e)) throw new DomainError('INVITE_ALREADY_USED');
      throw e;
    }
  }

  async saveState(review: Review, expected: ReviewState, tx?: TxHandle): Promise<boolean> {
    const m = review.moderation;
    const { count } = await asPrisma(this.prisma, tx).review.updateMany({
      where: { id: review.id, state: expected },
      data: {
        state: review.state,
        moderatedById: m?.byId ?? null,
        moderatedAt: m?.at ?? null,
        moderationNote: m?.note ?? null,
      },
    });
    return count === 1;
  }

  async saveReply(review: Review, tx?: TxHandle): Promise<void> {
    const db = asPrisma(this.prisma, tx);
    const reply = review.reply;
    switch (review.replyChange) {
      case null:
        return;
      case 'deleted': {
        // A HARD delete. No tombstone: the salon's own words, withdrawn.
        const { count } = await db.reviewReply.deleteMany({
          where: { id: review.deletedReplyId ?? '', reviewId: review.id },
        });
        if (count !== 1) throw new DomainError('REPLY_NOT_FOUND');
        return;
      }
      case 'edited': {
        const { count } = await db.reviewReply.updateMany({
          where: { id: reply!.id, reviewId: review.id },
          data: { body: reply!.body, editedById: reply!.editedById, editedAt: reply!.editedAt },
        });
        if (count !== 1) throw new DomainError('REPLY_NOT_FOUND');
        return;
      }
      case 'created':
        if (review.deletedReplyId !== null) {
          await db.reviewReply.deleteMany({ where: { id: review.deletedReplyId } });
        }
        try {
          await db.reviewReply.create({
            data: {
              id: reply!.id,
              tenantId: review.subject.tenantId,
              reviewId: review.id,
              body: reply!.body,
              authorId: reply!.authorId,
              editedById: reply!.editedById,
              editedAt: reply!.editedAt,
              createdAt: reply!.createdAt,
            },
          });
        } catch (e) {
          // Two managers replying at once: the second insert hits
          // UNIQUE (review_id) and is told, rather than overwriting.
          if (isUniqueViolation(e)) {
            throw new DomainError(
              'REPLY_ALREADY_EXISTS',
              'This review already has a reply. Edit it instead of adding a second one.',
            );
          }
          throw e;
        }
    }
  }

  async eraseCustomer(customerId: string, tenantId: string | null, tx?: TxHandle): Promise<number> {
    const { count } = await asPrisma(this.prisma, tx).review.updateMany({
      where: { customerId, ...(tenantId ? { tenantId } : {}) },
      data: { customerId: null, authorDisplayName: '' },
    });
    return count;
  }
}
