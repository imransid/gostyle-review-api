import { describe, expect, it } from 'vitest';
import {
  canReporterTransition,
  canResolverTransition,
  checkReportSubmission,
  OPEN_REPORT_STATUS,
  REPORT_NOTE_MAX,
  REPORT_NOTE_MIN,
  REPORT_REASONS,
  REPORT_REVIEW_TRANSITIONS,
  REPORT_STATUSES,
  REPORT_TRANSITIONS,
  ReportStatus,
  validateResolutionNote,
} from './review-report-rules';
import { REVIEW_STATES } from './review-rules';

describe('report reasons', () => {
  it('are exactly the five the console offers', () => {
    expect([...REPORT_REASONS]).toEqual([
      'WRONG_BRANCH_OR_BUSINESS',
      'OFF_TOPIC_OR_SPAM',
      'HARASSMENT',
      'COMPETITOR_PROMOTION',
      'FAKE_NO_VISIT',
    ]);
  });

  it('offer NO way to report a review for being negative', () => {
    // The product decision, pinned. Every reason is a claim about the review's
    // VALIDITY; a one-star review from a real customer who had a bad time is
    // exactly what this system exists to publish. If somebody adds "unfair" or
    // "inaccurate" to the enum, this fails and they have to argue for it.
    const sentimentWords = [
      'UNFAIR',
      'INACCURATE',
      'DISAGREE',
      'NEGATIVE',
      'HARSH',
      'WRONG_RATING',
    ];
    for (const reason of REPORT_REASONS) {
      expect(sentimentWords).not.toContain(reason);
    }
  });
});

describe('report statuses', () => {
  it('are OPEN, UPHELD and DISMISSED', () => {
    expect([...REPORT_STATUSES]).toEqual(['OPEN', 'UPHELD', 'DISMISSED']);
  });

  it('do NOT leak into the review states', () => {
    // "Whether somebody has complained is a fact about the report, not about
    // the review." A REPORTED review state would make the aggregate ask a
    // question it must not have to answer — does a reported review count
    // toward the average — so the two vocabularies stay disjoint.
    for (const status of REPORT_STATUSES) {
      expect(REVIEW_STATES as readonly string[]).not.toContain(status);
    }
    expect([...REVIEW_STATES]).toEqual(['PUBLISHED', 'HIDDEN', 'REMOVED']);
  });

  it('names OPEN as the one that blocks a second report', () => {
    expect(OPEN_REPORT_STATUS).toBe('OPEN');
  });
});

describe('the two transition maps are disjoint', () => {
  it('gives the REPORTER no moves at all', () => {
    // The safety property, asserted rather than described. A salon files a
    // report; it cannot resolve one. An empty map is what makes "reporting is
    // not moderation" true in code rather than only in a comment.
    for (const from of REPORT_STATUSES) {
      expect(REPORT_TRANSITIONS[from]).toEqual([]);
    }
  });

  it('gives the RESOLVER both outcomes from OPEN and nothing after', () => {
    expect(REPORT_REVIEW_TRANSITIONS.OPEN).toEqual(['UPHELD', 'DISMISSED']);
    expect(REPORT_REVIEW_TRANSITIONS.UPHELD).toEqual([]);
    expect(REPORT_REVIEW_TRANSITIONS.DISMISSED).toEqual([]);
  });

  it('shares no legal edge between the two maps', () => {
    // The pair-by-pair version: there is no (from, to) that BOTH a salon and a
    // reviewer may take. If the maps were ever merged with an actor column,
    // one careless edit would let the reporting party decide its own report,
    // and this is the test that would catch it.
    for (const from of REPORT_STATUSES) {
      for (const to of REPORT_STATUSES) {
        expect(canReporterTransition(from, to) && canResolverTransition(from, to)).toBe(false);
      }
    }
  });

  it('refuses to re-decide a report that is already resolved', () => {
    expect(canResolverTransition('UPHELD', 'DISMISSED')).toBe(false);
    expect(canResolverTransition('DISMISSED', 'UPHELD')).toBe(false);
    // A second look is a NEW report with a new date, which the partial unique
    // index on (review_id) WHERE status = 'OPEN' is what permits.
    expect(canResolverTransition('DISMISSED', 'OPEN')).toBe(false);
  });
});

describe('checkReportSubmission', () => {
  it('accepts a reason with no note', () => {
    const { errors, normalized } = checkReportSubmission({ reason: 'OFF_TOPIC_OR_SPAM' });
    expect(errors).toEqual([]);
    expect(normalized).toEqual({ reason: 'OFF_TOPIC_OR_SPAM', note: null });
  });

  it('rejects an unknown reason', () => {
    const { errors } = checkReportSubmission({ reason: 'UNFAIR' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ field: 'reason', code: 'UNKNOWN_VALUE' });
  });

  it('rejects a missing reason', () => {
    const { errors } = checkReportSubmission({});
    expect(errors[0]).toMatchObject({ field: 'reason', code: 'UNKNOWN_VALUE' });
  });

  it('trims the note and collapses a blank one to null', () => {
    const { errors, normalized } = checkReportSubmission({
      reason: 'HARASSMENT',
      note: '   \n  ',
    });
    expect(errors).toEqual([]);
    expect(normalized.note).toBeNull();
  });

  it('keeps a real note, trimmed', () => {
    const { normalized } = checkReportSubmission({
      reason: 'HARASSMENT',
      note: '  names our stylist  ',
    });
    expect(normalized.note).toBe('names our stylist');
  });

  it('rejects a note past the cap', () => {
    const { errors } = checkReportSubmission({
      reason: 'HARASSMENT',
      note: 'x'.repeat(REPORT_NOTE_MAX + 1),
    });
    expect(errors[0]).toMatchObject({ field: 'note', code: 'TOO_LONG' });
  });

  it('accepts a note exactly at the cap', () => {
    // The accepting side of the boundary, so the cap is pinned from both
    // directions rather than only where it refuses.
    const { errors } = checkReportSubmission({
      reason: 'HARASSMENT',
      note: 'x'.repeat(REPORT_NOTE_MAX),
    });
    expect(errors).toEqual([]);
  });

  it('does NOT impose the resolution note minimum on a salon', () => {
    // The asymmetry, asserted. A reason is already a closed claim a reviewer
    // can act on, so demanding prose from the salon would produce "see above".
    const { errors } = checkReportSubmission({ reason: 'FAKE_NO_VISIT', note: 'no' });
    expect(errors).toEqual([]);
  });

  it('never throws on junk', () => {
    expect(() => checkReportSubmission(null)).not.toThrow();
    expect(() => checkReportSubmission(undefined)).not.toThrow();
    expect(() => checkReportSubmission('nonsense')).not.toThrow();
    expect(checkReportSubmission({ reason: 'HARASSMENT', note: 42 }).errors[0]).toMatchObject({
      field: 'note',
      code: 'INVALID_FORMAT',
    });
  });
});

describe('validateResolutionNote', () => {
  const ok = 'The reviewer confirmed they visited the branch next door.';

  it('accepts a real reason', () => {
    expect(validateResolutionNote(ok)).toEqual([]);
  });

  it('requires one — on BOTH outcomes, which is why there is one function', () => {
    // Upholding hides a real customer's words and dismissing refuses a salon
    // that took the trouble to complain. Both owe an explanation, so uphold
    // and dismiss call this same validator rather than one of them skipping it.
    expect(validateResolutionNote(undefined)[0]).toMatchObject({ code: 'REQUIRED' });
    expect(validateResolutionNote(null)[0]).toMatchObject({ code: 'REQUIRED' });
    expect(validateResolutionNote('')[0]).toMatchObject({ code: 'REQUIRED' });
    expect(validateResolutionNote('    ')[0]).toMatchObject({ code: 'REQUIRED' });
  });

  it('refuses a note too short to act on', () => {
    expect(validateResolutionNote('x'.repeat(REPORT_NOTE_MIN - 1))[0]).toMatchObject({
      code: 'OUT_OF_RANGE',
    });
  });

  it('accepts a note exactly at the minimum', () => {
    expect(validateResolutionNote('x'.repeat(REPORT_NOTE_MIN))).toEqual([]);
  });

  it('refuses a note past the cap and accepts one exactly at it', () => {
    expect(validateResolutionNote('x'.repeat(REPORT_NOTE_MAX))).toEqual([]);
    expect(validateResolutionNote('x'.repeat(REPORT_NOTE_MAX + 1))[0]).toMatchObject({
      code: 'TOO_LONG',
    });
  });

  it('measures the TRIMMED length, not the raw one', () => {
    // Padding is not an explanation. Without the trim, twenty spaces would
    // satisfy a ten-character minimum.
    const padded = `${' '.repeat(50)}short${' '.repeat(50)}`;
    expect(validateResolutionNote(padded)[0]).toMatchObject({ code: 'OUT_OF_RANGE' });
  });
});

describe('the status vocabulary is closed', () => {
  it('has no member the resolver map does not know', () => {
    // Guards the case where somebody adds a status to the array and forgets
    // the map: REPORT_REVIEW_TRANSITIONS[newStatus] would be undefined and
    // canResolverTransition would throw at runtime instead of returning false.
    for (const status of REPORT_STATUSES) {
      expect(REPORT_REVIEW_TRANSITIONS[status as ReportStatus]).toBeDefined();
      expect(REPORT_TRANSITIONS[status as ReportStatus]).toBeDefined();
    }
  });
});
