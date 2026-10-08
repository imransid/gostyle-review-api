import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../src/review/domain/domain.error';
import { ReviewReport } from '../../../src/review/domain/report/review-report.aggregate';
import { REPORT_REASONS } from '../../../src/review/domain/services/review-report-rules';
import { HQ, NOTE, NOW, STAFF, submitReview } from './fixtures';

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as DomainError).code;
  }
  return 'no error';
};

const file = (review = submitReview()) =>
  ReviewReport.file({
    review: { id: review.id, tenantId: review.subject.tenantId },
    reason: 'OFF_TOPIC_OR_SPAM',
    note: '  copy-paste advert ',
    reportedById: STAFF,
    now: NOW,
  });

describe('ReviewReport.file', () => {
  it('has exactly five reasons', () => {
    expect(REPORT_REASONS).toHaveLength(5);
  });

  it('opens a report and changes NOTHING about the review', () => {
    const review = submitReview();
    const report = file(review);
    expect(report.status).toBe('OPEN');
    expect(report.note).toBe('copy-paste advert');
    expect(review.state).toBe('PUBLISHED');
    expect(review.isVisible).toBe(true);
    expect((report.getUncommittedEvents()[0] as any).type).toBe('review.report.filed.v1');
  });

  it('refuses a reason outside the five', () => {
    const review = submitReview();
    expect(
      codeOf(() =>
        ReviewReport.file({
          review: { id: review.id, tenantId: review.subject.tenantId },
          reason: 'UNFAIR',
          note: null,
          reportedById: STAFF,
          now: NOW,
        }),
      ),
    ).toBe('VALIDATION_FAILED');
  });
});

describe('resolution', () => {
  it('UPHELD and DISMISSED both need a real note and are both terminal', () => {
    const a = file();
    expect(codeOf(() => a.uphold(HQ, 'short', NOW))).toBe('VALIDATION_FAILED');
    a.uphold(HQ, NOTE, NOW);
    expect(a.status).toBe('UPHELD');
    expect(codeOf(() => a.dismiss(HQ, NOTE, NOW))).toBe('REPORT_TRANSITION_INVALID');
    expect(codeOf(() => a.uphold(HQ, NOTE, NOW))).toBe('REPORT_TRANSITION_INVALID');

    const b = file();
    b.dismiss(HQ, NOTE, NOW);
    expect(b.status).toBe('DISMISSED');
    expect(b.resolutionNote).toBe(NOTE);
    expect(codeOf(() => b.uphold(HQ, NOTE, NOW))).toBe('REPORT_TRANSITION_INVALID');
  });

  it('dismissing leaves the review exactly as it was', () => {
    const review = submitReview();
    const report = file(review);
    report.dismiss(HQ, NOTE, NOW);
    expect(review.state).toBe('PUBLISHED');
  });
});
