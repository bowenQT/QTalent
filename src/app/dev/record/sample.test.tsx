// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/components/ui/Toast';
import type { MaterialBatchInput } from '@/contracts/materials';
import { RECORD_UNDO_WINDOW_MS } from '@/contracts/record';
import RecordSample from './page';
import { SampleRecord } from './SampleRecord';
import { SAMPLE_NODE, STEP_MS, sampleServer } from './sample-actions';
import {
  SENTENCE,
  SUBJECT,
  sampleDraft,
  samplePeople,
  sampleShell,
  type SampleScene,
} from './samples';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not-found');
  },
  usePathname: () => '/dev/record',
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace }),
}));

beforeEach(() => {
  sessionStorage.clear();
  replace.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const input = (
  text = SENTENCE,
  personIds: string[] = [SUBJECT],
  operationId = 'op-1',
): MaterialBatchInput => ({
  operationId,
  evaluationNodeId: SAMPLE_NODE,
  personIds,
  projectId: null,
  text,
  files: [],
});

function server(scene: SampleScene = 'normal', storage?: Storage) {
  let clock = 1_000_000;
  const value = sampleServer({
    scene,
    accountId: 'p-suwan',
    storage,
    now: () => clock,
  });
  return {
    ...value,
    tick: (ms: number) => (clock += ms),
    read: async (batchId: string) => {
      const result = await value.actions.readBatch({ batchId });
      if (result.status !== 'success') throw new Error(result.status);
      return result.result;
    },
  };
}

async function arranged(s: ReturnType<typeof server>, value = input()) {
  const started = await s.actions.submit(value);
  if (started.status !== 'success') throw new Error(started.status);
  const { batchId } = started.result;
  s.tick(STEP_MS * 3);
  const receipt = await s.read(batchId);
  return { batchId, receipt, draft: receipt.draftSet?.drafts[0] };
}

const saveInput = (draftId: string, revision: number) => ({
  operation_id: 'op-save',
  expected_revision: revision,
  draftId,
  personIds: [SUBJECT],
  projectId: null,
  sbi: { title: 't', situation: '', behavior: 'b', impact: '' },
  decisions: [
    { personId: SUBJECT, dimensionId: 'mot', action: 'confirm' as const },
  ],
});

describe('sample server', () => {
  it('derives one node, arranges the sentence with time into one draft', async () => {
    const s = server();
    expect(
      await s.actions.resolveNode!({ personIds: [SUBJECT], projectId: null }),
    ).toEqual({ status: 'unique', evaluationNodeId: SAMPLE_NODE });
    // Like BOW-845: an empty selection derives no node.
    expect(
      await s.actions.resolveNode!({ personIds: [], projectId: null }),
    ).toEqual({ status: 'none' });
    const started = await s.actions.submit(input());
    if (started.status !== 'success') throw new Error(started.status);
    expect(started.result).toMatchObject({
      status: 'processing',
      draftSet: null,
    });
    s.tick(STEP_MS);
    expect((await s.read(started.result.batchId)).status).toBe('processing');
    s.tick(STEP_MS * 2);
    const done = await s.read(started.result.batchId);
    expect(done.status).toBe('awaiting_confirmation');
    expect(done.draftSet?.drafts).toHaveLength(1);
    const [draft] = done.draftSet!.drafts;
    expect(draft!.scores[0]).toMatchObject({ state: 'suggested', value: 4 });
    // The same operation replays the same batch.
    const again = await s.actions.submit(input());
    expect(again.status === 'success' && again.replayed).toBe(true);
  });

  it('never scores a sentence without the quote', () => {
    const draft = sampleDraft({
      batchId: 'b',
      draftId: 'd',
      evaluationNodeId: SAMPLE_NODE,
      personId: SUBJECT,
      text: '开了个会',
    });
    expect(draft.scores.every((score) => score.state === 'unknown')).toBe(true);
  });

  it('saves with a five-second undo window and refuses undo after it', async () => {
    const s = server();
    const { batchId, draft } = await arranged(s);
    const saved = await s.actions.save(saveInput(draft!.draftId, 1));
    if (saved.status !== 'success') throw new Error(saved.status);
    expect(
      Date.parse(saved.result.undoUntil) - Date.parse(saved.result.savedAt),
    ).toBe(RECORD_UNDO_WINDOW_MS);
    const after = await s.read(batchId);
    expect(after).toMatchObject({ status: 'completed', draftSet: null });
    expect(after.confirmedDrafts).toHaveLength(1);
    s.tick(RECORD_UNDO_WINDOW_MS);
    expect(
      (
        await s.actions.undo({
          operation_id: 'op-undo',
          saveId: saved.result.saveId,
        })
      ).status,
    ).toBe('conflict');
  });

  it('undoes within the window without handing the input back (846), draft returns', async () => {
    const s = server();
    const { batchId, draft } = await arranged(s);
    const saved = await s.actions.save(saveInput(draft!.draftId, 1));
    if (saved.status !== 'success') throw new Error(saved.status);
    const undone = await s.actions.undo({
      operation_id: 'op-undo',
      saveId: saved.result.saveId,
    });
    expect(undone.status === 'success' && undone.result).toMatchObject({
      inputRestoration: 'unavailable',
      originalInput: null,
    });
    expect((await s.read(batchId)).draftSet?.drafts[0]?.draftId).toBe(
      draft!.draftId,
    );
  });

  it('rejects a stale revision, a missing draft and a missing batch', async () => {
    const s = server();
    const { draft } = await arranged(s);
    expect((await s.actions.save(saveInput(draft!.draftId, 9))).status).toBe(
      'conflict',
    );
    expect((await s.actions.save(saveInput('nope', 1))).status).toBe(
      'not_found',
    );
    expect((await s.actions.readBatch({ batchId: 'nope' })).status).toBe(
      'not_found',
    );
  });

  it('conflict scene: the first save comes back with the edits and a newer draft', async () => {
    const s = server('conflict');
    const { batchId, draft } = await arranged(s);
    const first = await s.actions.save(saveInput(draft!.draftId, 1));
    expect(first.status).toBe('conflict');
    expect((await s.read(batchId)).draftSet?.drafts[0]?.revision).toBe(2);
    expect((await s.actions.save(saveInput(draft!.draftId, 2))).status).toBe(
      'success',
    );
  });

  it('fail scene: the first batch fails at step 2, a new batch arranges', async () => {
    const s = server('fail');
    const started = await s.actions.submit(input());
    if (started.status !== 'success') throw new Error(started.status);
    s.tick(STEP_MS * 2);
    const failed = await s.read(started.result.batchId);
    expect(failed).toMatchObject({
      status: 'failed',
      error: { retryable: true },
    });
    const { receipt } = await arranged(s, input(SENTENCE, [SUBJECT], 'op-2'));
    expect(receipt.status).toBe('awaiting_confirmation');
  });

  it('offline scene: the first submit never arrives, the second does', async () => {
    const s = server('offline');
    await expect(s.actions.submit(input())).rejects.toThrow();
    expect((await s.actions.submit(input())).status).toBe('success');
  });

  it('many scene: two events; review scene: one open item and no draft', async () => {
    const many = await arranged(server('many'));
    expect(many.receipt.draftSet?.drafts).toHaveLength(2);
    const review = await arranged(server('review'));
    expect(review.receipt).toMatchObject({
      status: 'needs_review',
      draftSet: null,
    });
    expect(review.receipt.items[0]?.kind).toBe('unknown_person');
  });

  it('node scenes answer multiple or none', async () => {
    for (const [scene, status] of [
      ['node-multiple', 'multiple'],
      ['node-none', 'none'],
    ] as const)
      expect(
        await server(scene).actions.resolveNode!({
          personIds: [SUBJECT],
          projectId: null,
        }),
      ).toEqual({ status });
  });

  it('keeps batches across reloads and reads no stored sources', async () => {
    const first = server('normal', sessionStorage);
    const started = await first.actions.submit(input());
    if (started.status !== 'success') throw new Error(started.status);
    const second = server('normal', sessionStorage);
    second.tick(STEP_MS * 3);
    expect((await second.read(started.result.batchId)).status).toBe(
      'awaiting_confirmation',
    );
    expect(
      (
        await second.actions.loadSource({
          fragmentId: 'f',
          originalVersionId: 'v',
        })
      ).status,
    ).toBe('not_found');
  });

  it('starts over from broken storage', async () => {
    sessionStorage.setItem('qtalent-dev-record:p-suwan:normal', '{');
    const s = server('normal', sessionStorage);
    expect((await s.actions.submit(input())).status).toBe('success');
  });

  it('gives every person the same anchors for each dimension', async () => {
    const map = await server().loadAnchors({
      personIds: [SUBJECT],
      ruleVersions: ['rubric-v1'],
    });
    expect(Object.keys(map[SUBJECT]!)).toContain('mot');
  });
});

describe('samples', () => {
  it('gives mentors only their students and every role a sample shell', () => {
    expect(samplePeople('mentor').length).toBeLessThan(
      samplePeople('hr').length,
    );
    expect(sampleShell('mentor').account.roleLabel).toBe('导师');
    expect(sampleShell('manager').role).toBe('manager');
  });
});

describe('/dev/record', () => {
  it('is not served in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await expect(
      RecordSample({ searchParams: Promise.resolve({ role: 'hr' }) }),
    ).rejects.toThrow('not-found');
  });

  it('needs a known role and scene', async () => {
    await expect(
      RecordSample({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('not-found');
    await expect(
      RecordSample({
        searchParams: Promise.resolve({ role: 'hr', scene: 'selection' }),
      }),
    ).rejects.toThrow('not-found');
    expect(
      await RecordSample({
        searchParams: Promise.resolve({ role: 'mentor', person: SUBJECT }),
      }),
    ).toBeTruthy();
  });

  it('puts the batch in the URL while arranging, never the text', async () => {
    render(
      <ToastProvider>
        <SampleRecord
          role="hr"
          scene="normal"
          personId={SUBJECT}
          handoff={false}
          batchId={null}
        />
      </ToastProvider>,
    );
    expect(screen.getByText('内生动力 · 1–5 分锚点')).toBeTruthy();
    await userEvent.type(
      screen.getByRole('textbox', { name: '说说这次发生了什么' }),
      '孟逸尘今天开了个会',
    );
    await userEvent.click(
      screen.getByRole('button', { name: /整理成关键事件/ }),
    );
    await waitFor(() => expect(replace).toHaveBeenCalled());
    const url = replace.mock.calls.at(-1)?.[0] as string;
    expect(url).toMatch(/batch=sample-batch-\d+/);
    expect(decodeURIComponent(url)).not.toContain('开了个会');
  });
});
