import { describe, expect, it } from 'vitest';
import { isUuid, uuidv7 } from '../../../src/review/domain/shared/uuidv7';

describe('uuidv7', () => {
  it('is a version 7, RFC variant uuid', () => {
    const id = uuidv7();
    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe('7');
    expect('89ab').toContain(id[19]);
  });

  it('starts with the millisecond timestamp, so ids sort by time', () => {
    const a = uuidv7(Date.UTC(2026, 0, 1));
    const b = uuidv7(Date.UTC(2026, 0, 2));
    expect(a < b).toBe(true);
    expect(parseInt(a.replace(/-/g, '').slice(0, 12), 16)).toBe(Date.UTC(2026, 0, 1));
  });
});
