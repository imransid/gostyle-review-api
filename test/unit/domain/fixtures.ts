import { ReviewInvite } from '../../../src/review/domain/invite/review-invite.aggregate';
import { Review } from '../../../src/review/domain/review/review.aggregate';
import { AuthorName } from '../../../src/review/domain/value-objects/author-name';
import { BookingRef } from '../../../src/review/domain/value-objects/booking-ref';
import { Comment } from '../../../src/review/domain/value-objects/comment';
import { Rating } from '../../../src/review/domain/value-objects/rating';
import { ReviewLanguage } from '../../../src/review/domain/value-objects/review-language';
import { SubjectRef } from '../../../src/review/domain/value-objects/subject-ref';

export const TENANT = '0190a1b2-0000-7000-8000-000000000001';
export const STOREFRONT = '0190a1b2-0000-7000-8000-000000000002';
export const BRANCH = '0190a1b2-0000-7000-8000-000000000003';
export const BOOKING = '0190a1b2-0000-7000-8000-000000000004';
export const CUSTOMER = '0190a1b2-0000-7000-8000-000000000005';
export const STAFF = '0190a1b2-0000-7000-8000-000000000006';
export const HQ = '0190a1b2-0000-7000-8000-000000000007';
export const NOW = new Date('2026-10-08T12:00:00.000Z');

export const subject = () =>
  SubjectRef.of({ tenantId: TENANT, storefrontId: STOREFRONT, branchId: BRANCH });
export const booking = (source: 'platform' | 'booking_api' = 'platform') =>
  BookingRef.of(source, BOOKING);
export const salon = { tenantId: TENANT, branchId: BRANCH, userId: STAFF };

export function mintInvite() {
  return ReviewInvite.mint({
    subject: subject(),
    booking: booking(),
    customerId: CUSTOMER,
    display: { salonName: 'Marina Walk', storefrontSlug: 'marina-walk', locale: 'en' },
    now: NOW,
  });
}

export function submitReview(rating = 5, language: 'EN' | 'AR' = 'EN') {
  const { invite } = mintInvite();
  return Review.submit({
    invite: {
      id: invite.id,
      subject: invite.subject,
      booking: invite.booking,
      customerId: invite.customerId,
    },
    rating: Rating.of(rating),
    comment: Comment.of('Lovely'),
    language: ReviewLanguage.of(language),
    authorName: AuthorName.of('Sara'),
    now: NOW,
  });
}

export const NOTE = 'Reviewed against the booking record and the salon’s note.';
