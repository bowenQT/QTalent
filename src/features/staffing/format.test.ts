import { describe, expect, it } from 'vitest';
import { formatDay, personHref, projectHref } from './format';

describe('format', () => {
  it('shows business dates as MM-DD in the company time zone', () => {
    expect(formatDay('2026-09-01T02:00:00Z')).toBe('09-01');
    // 17:00 UTC is already the next day in Shanghai.
    expect(formatDay('2026-09-03T17:00:00Z')).toBe('09-04');
  });

  it('builds person and project links with encoded ids', () => {
    expect(personHref('p x')).toBe('/person?id=p%20x');
    expect(projectHref('pr/ts')).toBe('/project?id=pr%2Fts');
  });
});
