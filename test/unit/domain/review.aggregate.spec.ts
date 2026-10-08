import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../src/review/domain/domain.error';
import { Review } from '../../../src/review/domain/review/review.aggregate';
import { canTransition, REVIEW_TRANSITIONS } from '../../../src/review/domain/review/review-state';
import { HQ, NOTE, NOW, salon, STAFF, submitReview, TENANT } from './fixtures';

const types = (r: Review) => r.getUncommittedEvents().map((e: any) => e.type);
const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as DomainError).code;
  }
  return 'no error';
};

describe('Review.submit', () => {
  it('starts PUBLISHED, copies everything from the invite, and records review.submitted.v1', () => {
    const r = submitReview(4, 'AR');
    expect(r.state).toBe('PUBLISHED');
    expect(r.isVisible).toBe(true);
    expect(r.subject.tenantId).toBe(TENANT);
    expect(types(r)).toEqual(['review.submitted.v1']);
    const payload = (r.getUncommittedEvents()[0] as any).payload();
    expect(payload).toMatchObject({ rating: 4, language: 'AR', bookingSource: 'platform' });
  });
});

describe('the state machine', () => {
  it('PUBLISHED <-> HIDDEN, either -> REMOVED, REMOVED is final', () => {
    expect(REVIEW_TRANSITIONS).toEqual({
      PUBLISHED: ['HIDDEN', 'REMOVED'],
      HIDDEN: ['PUBLISHED', 'REMOVED'],
      REMOVED: [],
    });
    expect(canTransition('REMOVED', 'PUBLISHED')).toBe(false);
    expect(canTransition('REMOVED', 'HIDDEN')).toBe(false);
  });

  it('hides and restores, back and forth, counting only while PUBLISHED', () => {
    const r = submitReview();
    r.hide(HQ, NOTE, NOW);
    expect(r.state).toBe('HIDDEN');
    expect(r.isVisible).toBe(false);
    r.unhide(HQ, NOTE, NOW);
    expect(r.state).toBe('PUBLISHED');
    r.hide(HQ, NOTE, NOW);
    expect(types(r)).toEqual([
      'review.submitted.v1',
      'review.hidden.v1',
      'review.restored.v1',
      'review.hidden.v1',
    ]);
    expect(r.moderation).toEqual({ byId: HQ, at: NOW, note: NOTE });
  });

  it('removes from either visible state, and nothing moves a REMOVED review', () => {
    const a = submitReview();
    a.remove(HQ, NOTE, NOW);
    expect(a.state).toBe('REMOVED');
    const b = submitReview();
    b.hide(HQ, NOTE, NOW);
    b.remove(HQ, NOTE, NOW);
    expect(b.state).toBe('REMOVED');
    expect(codeOf(() => b.unhide(HQ, NOTE, NOW))).toBe('REVIEW_TRANSITION_INVALID');
    expect(codeOf(() => b.hide(HQ, NOTE, NOW))).toBe('REVIEW_TRANSITION_INVALID');
    expect(codeOf(() => b.remove(HQ, NOTE, NOW))).toBe('REVIEW_TRANSITION_INVALID');
  });

  it('refuses a move to the state it is already in', () => {
    const r = submitReview();
    expect(codeOf(() => r.unhide(HQ, NOTE, NOW))).toBe('REVIEW_TRANSITION_INVALID');
  });

  it('requires a real reason for every moderation move', () => {
    const r = submitReview();
    expect(codeOf(() => r.hide(HQ, 'bad', NOW))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => r.hide(HQ, undefined, NOW))).toBe('VALIDATION_FAILED');
    expect(r.state).toBe('PUBLISHED');
  });
});

describe('an upheld report', () => {
  it('hides a PUBLISHED review', () => {
    const r = submitReview();
    expect(r.hideForUpheldReport(HQ, NOTE, NOW, 'rep-1')).toBe('HIDDEN');
    const e = r.getUncommittedEvents().at(-1) as any;
    expect(e.type).toBe('review.hidden.v1');
    expect(e.payload()).toMatchObject({ cause: 'report_upheld', reportId: 'rep-1' });
  });

  it('keeps a HIDDEN review hidden and restamps it', () => {
    const r = submitReview();
    r.hide(HQ, NOTE, NOW);
    expect(r.hideForUpheldReport(STAFF, `${NOTE} again`, NOW, 'rep-2')).toBe('HIDDEN');
    expect(r.moderation?.byId).toBe(STAFF);
  });

  it('NEVER brings a REMOVED review back', () => {
    const r = submitReview();
    r.remove(HQ, NOTE, NOW);
    expect(r.hideForUpheldReport(HQ, NOTE, NOW, 'rep-3')).toBe('REMOVED');
    expect(r.state).toBe('REMOVED');
  });
});

describe('the salon reply', () => {
  it('one reply per review: a second is REPLY_ALREADY_EXISTS, not an overwrite', () => {
    const r = submitReview();
    r.postReply(salon, '  Thank you!  ', NOW);
    expect(r.reply?.body).toBe('Thank you!');
    expect(r.replyChange).toBe('created');
    expect(codeOf(() => r.postReply(salon, 'Again', NOW))).toBe('REPLY_ALREADY_EXISTS');
    expect(types(r)).toContain('review.reply.posted.v1');
  });

  it('is written only by staff of THAT salon: anyone else gets REVIEW_NOT_FOUND', () => {
    const r = submitReview();
    const otherBranch = { ...salon, branchId: TENANT };
    const otherTenant = { ...salon, tenantId: STAFF };
    expect(codeOf(() => r.postReply(otherBranch, 'x', NOW))).toBe('REVIEW_NOT_FOUND');
    expect(codeOf(() => r.postReply(otherTenant, 'x', NOW))).toBe('REVIEW_NOT_FOUND');
    expect(r.reply).toBeNull();
  });

  it('edits in place and records who edited', () => {
    const r = Review.restore({ ...(submitReview() as any).p });
    r.postReply(salon, 'First', NOW);
    r.editReply({ ...salon, userId: HQ }, 'Second', NOW);
    expect(r.reply?.body).toBe('Second');
    expect(r.reply?.editedById).toBe(HQ);
  });

  it('deleting removes it: there is nothing left, and a new reply may follow', () => {
    const r = submitReview();
    r.postReply(salon, 'Hello', NOW);
    r.deleteReply(salon, NOW);
    expect(r.reply).toBeNull();
    expect(r.replyChange).toBe('deleted');
    expect(codeOf(() => r.deleteReply(salon, NOW))).toBe('REPLY_NOT_FOUND');
    expect(codeOf(() => r.editReply(salon, 'x', NOW))).toBe('REPLY_NOT_FOUND');
  });

  it('refuses an empty reply rather than treating it as a delete', () => {
    const r = submitReview();
    expect(codeOf(() => r.postReply(salon, '   ', NOW))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => r.postReply(salon, 'x'.repeat(1501), NOW))).toBe('VALIDATION_FAILED');
  });
});

describe('erasure', () => {
  it('blanks the name and the customer link, and keeps the words', () => {
    const r = submitReview();
    r.eraseCustomer();
    expect(r.customerId).toBeNull();
    expect(r.authorName.stored).toBe('');
    expect(r.authorName.display()).toBe('Verified customer');
    expect(r.comment.value).toBe('Lovely');
  });
});
