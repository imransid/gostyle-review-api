import { describe, expect, it } from 'vitest';
import { checkReplySubmission, REPLY_MAX, validateReplySubmission } from './review-reply-rules';
import { COMMENT_MAX } from './review-rules';

describe('checkReplySubmission', () => {
  it('accepts a reply and trims it', () => {
    const { errors, normalized } = checkReplySubmission({ body: '  Sorry about that.  ' });
    expect(errors).toEqual([]);
    expect(normalized.body).toBe('Sorry about that.');
  });

  it('requires a body', () => {
    expect(checkReplySubmission({}).errors[0]).toMatchObject({ field: 'body', code: 'REQUIRED' });
    expect(checkReplySubmission({ body: 42 }).errors[0]).toMatchObject({
      field: 'body',
      code: 'REQUIRED',
    });
  });

  it('refuses an empty reply rather than treating it as a delete', () => {
    // The distinction the endpoint set depends on. If blanking the body were
    // accepted, "has the salon responded" would be unanswerable from the row —
    // which is the one thing a customer reading the page wants to know.
    const { errors } = checkReplySubmission({ body: '     ' });
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('REQUIRED');
    expect(errors[0].message).toContain('Delete the reply instead');
  });

  it('refuses a reply past the cap and accepts one exactly at it', () => {
    expect(checkReplySubmission({ body: 'x'.repeat(REPLY_MAX) }).errors).toEqual([]);
    expect(checkReplySubmission({ body: 'x'.repeat(REPLY_MAX + 1) }).errors[0]).toMatchObject({
      code: 'TOO_LONG',
    });
  });

  it('measures the TRIMMED length', () => {
    // Otherwise trailing whitespace could push a legal reply over the cap, and
    // the salon would be refused for characters they cannot see.
    const body = `${'x'.repeat(REPLY_MAX)}${' '.repeat(20)}`;
    expect(checkReplySubmission({ body }).errors).toEqual([]);
  });

  it('never throws on junk', () => {
    expect(() => checkReplySubmission(null)).not.toThrow();
    expect(() => checkReplySubmission(undefined)).not.toThrow();
    expect(() => checkReplySubmission('nonsense')).not.toThrow();
  });
});

describe('validateReplySubmission', () => {
  it('returns the errors only', () => {
    expect(validateReplySubmission({ body: 'fine' })).toEqual([]);
    expect(validateReplySubmission({ body: '' })).toHaveLength(1);
  });
});

describe('the cap', () => {
  it('is longer than a customer comment, on purpose', () => {
    // A salon answering a specific complaint needs room to address it — "we
    // refunded this and retrained the stylist" is longer than the sentence
    // that prompted it — and unlike the review, this text comes from an
    // authenticated console user whose account is known, so the surface-area
    // argument that caps the review does not apply.
    expect(REPLY_MAX).toBeGreaterThan(COMMENT_MAX);
  });
});
