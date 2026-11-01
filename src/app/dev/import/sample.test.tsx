// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/components/ui/Toast';
import { rowState } from '@/features/interview-import/model';
import ImportSample from './page';
import { SampleImport } from './SampleImport';
import { restore, samplePorts, storageKey } from './sample-ports';
import { sampleBatch } from './samples';

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not-found');
  },
  usePathname: () => '/dev/import',
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const key = storageKey(sampleBatch.id);

beforeEach(() => sessionStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('sample ports', () => {
  it('starts from the prototype batch: every state the preview shows', () => {
    expect(restore(sampleBatch, null).rows.map(rowState)).toEqual([
      'confirm',
      'verify',
      // Rejected and not yet joined: 906 asks who they are before it skips them.
      'unknown',
      'unknown',
      'confirm',
      'dup',
      'unknown',
    ]);
  });

  it('stores each change, so a new page load returns the same rows', async () => {
    const ports = samplePorts(sampleBatch, sessionStorage);
    expect(await ports.confirm('imp-1', 'r1', true)).toMatchObject({
      status: 'ok',
      row: { rowId: 'r1', confirmed: true },
    });
    await ports.fill('imp-1', 'r2', '系统设计', 'B');
    await ports.sendToReview('imp-1', 'r7');
    const again = restore(sampleBatch, sessionStorage.getItem(key));
    const byId = new Map(again.rows.map((r) => [r.rowId, r]));
    expect(rowState(byId.get('r1')!)).toBe('confirmed');
    expect(byId.get('r2')!.filled).toEqual({ 系统设计: 'B' });
    expect(rowState(byId.get('r7')!)).toBe('sent');
    expect(byId.get('r7')!.reviewItemId).toBe('i-iv-r7');
    expect(rowState(byId.get('r5')!)).toBe('confirm');
  });

  it('answers a conflict for another batch or an unknown row', async () => {
    const ports = samplePorts(sampleBatch, sessionStorage);
    expect((await ports.confirm('imp-2', 'r1', true)).status).toBe('conflict');
    expect((await ports.confirm('imp-1', 'r9', true)).status).toBe('conflict');
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  it('ignores stored data it cannot read', () => {
    for (const raw of ['not json', '{"r1":{"confirmed":"yes"}}', ''])
      expect(restore(sampleBatch, raw).rows).toEqual(sampleBatch.rows);
  });
});

describe('/dev/import', () => {
  it('serves 404 in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => ImportSample()).toThrow('not-found');
  });

  it('renders the sample inside the shell in development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const page = ImportSample();
    expect(page.props.data.account.name).toBe('苏晚');
  });

  it('keeps confirmed rows when HR comes back to the page', async () => {
    const user = userEvent.setup();
    const first = render(
      <ToastProvider>
        <SampleImport />
      </ToastProvider>,
    );
    await user.click(await screen.findByRole('button', { name: '是孟逸尘' }));
    await waitFor(() =>
      expect(document.getElementById('iv-r1')?.dataset.state).toBe('confirmed'),
    );
    first.unmount();
    render(
      <ToastProvider>
        <SampleImport />
      </ToastProvider>,
    );
    expect(
      (await screen.findByText('已确认是孟逸尘')).closest('article')?.id,
    ).toBe('iv-r1');
    expect(document.querySelector('.n-ivbar')?.textContent).toContain(
      '已确认 1 行',
    );
  });
});
