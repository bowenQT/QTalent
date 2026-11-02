import type { WorkbenchView } from './view';

/** Synthetic views for section tests (not prototype data, not a page fallback). */
export function testView(
  overrides: Partial<WorkbenchView> = {},
): WorkbenchView {
  return {
    role: 'hr',
    displayName: '演示 HR',
    asOf: '2026-09-04',
    entries: { record: true, findPeople: true },
    accountId: 'test-account',
    namedExamples: true,
    exportable: { status: 'not_connected' },
    ...overrides,
  };
}
