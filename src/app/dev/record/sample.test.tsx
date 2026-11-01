// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/components/ui/Toast';
import {
  RECORD_UNDO_WINDOW_MS,
  type RecordDraft,
  type RecordInput,
} from '@/contracts/record';
import type { RecordJob } from '@/features/record/types';
import RecordSample from './page';
import { SampleRecord } from './SampleRecord';
import { STEP_MS, sampleServer } from './sample-actions';
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

const input = (text = SENTENCE, personId: string | null = null) =>
  ({
    operation_id: 'op-1',
    text,
    attachmentIds: [],
    personId,
    projectId: null,
  }) satisfies RecordInput;

function server(scene: SampleScene = 'normal', storage?: Storage) {
  let clock = 1_000_000;
  const value = sampleServer({
    scene,
    accountId: 'p-suwan',
    people: samplePeople('hr'),
    storage,
    now: () => clock,
  });
  return {
    ...value,
    tick: (ms: number) => (clock += ms),
    read: (jobId: string) => value.readJob(jobId, new AbortController().signal),
  };
}

/** The arranged draft, or a failure when the job asked who it is instead. */
function asDraft(result: RecordJob['result']): RecordDraft {
  if (!result || 'state' in result) throw new Error('no draft');
  return result;
}

async function arranged(s: ReturnType<typeof server>) {
  const started = await s.actions.start(input());
  if (started.status !== 'success') throw new Error(started.status);
  const jobId = started.result.jobId;
  s.tick(STEP_MS * 3);
  return { jobId, draft: asDraft((await s.read(jobId)).result) };
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
  it('arranges the sentence step by step into the prototype draft', async () => {
    const s = server();
    const started = await s.actions.start(input());
    expect(started.status).toBe('success');
    if (started.status !== 'success') return;
    expect(started.result.status).toBe('queued');
    s.tick(STEP_MS);
    const running = await s.read(started.result.jobId);
    expect(running.status).toBe('running');
    expect(running.progress).toEqual({ completed: 1, total: 3 });
    s.tick(STEP_MS * 2);
    const done = await s.read(started.result.jobId);
    expect(done.status).toBe('awaiting_manual');
    expect(done.revision).toBeGreaterThan(running.revision);
    const draft = asDraft(done.result);
    expect(draft.people).toEqual([{ state: 'resolved', id: SUBJECT }]);
    // One suggested score with anchor, quote and rule version; the rest left open.
    expect(draft.scores).toMatchObject([
      {
        dimensionId: 'mot',
        state: 'suggested',
        value: 4,
        anchor: { ruleVersion: 'rubric-v1' },
        citations: [
          { kind: 'input', quote: '孟逸尘今天主动把任务池同步给了全组' },
        ],
      },
      { dimensionId: 'grit', state: 'unknown' },
    ]);
  });

  it('never scores a sentence without the quote', () => {
    const draft = sampleDraft(input('今天开了个会'), SUBJECT, 'd-1');
    expect(draft.scores.every((score) => score.state === 'unknown')).toBe(true);
  });

  it('saves with a five-second undo window and refuses undo after it', async () => {
    const s = server();
    const { draft } = await arranged(s);
    const saved = await s.actions.save(
      saveInput(draft.draftId, draft.revision),
    );
    if (saved.status !== 'success') throw new Error(saved.status);
    const receipt = saved.result;
    expect(Date.parse(receipt.undoUntil) - Date.parse(receipt.savedAt)).toBe(
      RECORD_UNDO_WINDOW_MS,
    );
    expect(receipt.confirmationIds).toHaveLength(1);
    s.tick(RECORD_UNDO_WINDOW_MS);
    expect(
      await s.actions.undo({ operation_id: 'op-u', saveId: receipt.saveId }),
    ).toMatchObject({
      status: 'conflict',
      message: '已超过撤销时间，这条记录已保存',
    });
  });

  it('undoes within the window and hands the original input back', async () => {
    const s = server();
    const { draft } = await arranged(s);
    const saved = await s.actions.save(
      saveInput(draft.draftId, draft.revision),
    );
    if (saved.status !== 'success') throw new Error(saved.status);
    s.tick(RECORD_UNDO_WINDOW_MS - 1);
    const undone = await s.actions.undo({
      operation_id: 'op-u',
      saveId: saved.result.saveId,
    });
    expect(undone).toMatchObject({
      status: 'success',
      result: { originalInput: { text: SENTENCE } },
    });
  });

  it('rejects a stale revision and a missing draft', async () => {
    const s = server();
    const { draft } = await arranged(s);
    expect(
      (await s.actions.save(saveInput(draft.draftId, draft.revision + 5)))
        .status,
    ).toBe('conflict');
    expect((await s.actions.save(saveInput('nope', 1))).status).toBe(
      'not_found',
    );
    expect((await s.actions.openDraft({ draftId: 'nope' })).status).toBe(
      'not_found',
    );
    expect((await s.actions.openDraft({ draftId: draft.draftId })).status).toBe(
      'success',
    );
  });

  it('conflict scene: the first save comes back with the edits and a newer draft', async () => {
    const s = server('conflict');
    const { draft } = await arranged(s);
    const first = await s.actions.save(
      saveInput(draft.draftId, draft.revision),
    );
    expect(first).toMatchObject({
      status: 'conflict',
      input: { draftId: draft.draftId },
    });
    const latest = await s.actions.openDraft({ draftId: draft.draftId });
    if (latest.status !== 'success') throw new Error();
    expect(latest.result.revision).toBe(draft.revision + 1);
    expect(
      (await s.actions.save(saveInput(draft.draftId, latest.result.revision)))
        .status,
    ).toBe('success');
  });

  it('fail scene: the first attempt stops at step 2 and retry continues', async () => {
    const s = server('fail');
    const started = await s.actions.start(input());
    if (started.status !== 'success') throw new Error();
    const { jobId } = started.result;
    s.tick(STEP_MS * 2);
    const failed = await s.read(jobId);
    expect(failed).toMatchObject({
      status: 'failed',
      canRetry: true,
      error: { code: 'processing_failed' },
    });
    const command = {
      jobId,
      action: 'retry' as const,
      operationId: 'op-r',
      expectedRevision: failed.revision,
    };
    const retried = await s.actions.retryJob(command);
    if (retried.status !== 'success') throw new Error(retried.status);
    expect(retried.snapshot.attempt).toBe(2);
    expect(retried.snapshot.revision).toBeGreaterThan(failed.revision);
    // Nothing failed any more: retrying again is a conflict.
    expect((await s.actions.retryJob(command)).status).toBe('conflict');
    expect(
      (await s.actions.retryJob({ ...command, jobId: 'nope' })).status,
    ).toBe('not_found');
    s.tick(STEP_MS * 3);
    expect((await s.read(jobId)).status).toBe('awaiting_manual');
  });

  it('offline scene: the first start never arrives, the second does', async () => {
    const s = server('offline');
    await expect(s.actions.start(input())).rejects.toThrow('Failed to fetch');
    expect((await s.actions.start(input())).status).toBe('success');
  });

  it('selection scene: asks who it is, then arranges for the chosen person', async () => {
    const s = server('selection');
    const started = await s.actions.start(input());
    if (started.status !== 'success') throw new Error();
    s.tick(STEP_MS * 3);
    const asked = await s.read(started.result.jobId);
    if (!asked.result || !('state' in asked.result)) throw new Error();
    expect(asked.result.people[0]).toMatchObject({ state: 'needs_selection' });
    const chosen = await s.actions.selectPeople({
      operation_id: 'op-s',
      draftId: asked.result.draftId,
      expected_input_version: asked.result.inputVersion,
      personIds: [SUBJECT],
      projectId: null,
    });
    expect(chosen.status).toBe('success');
    expect(
      (
        await s.actions.selectPeople({
          operation_id: 'op-s',
          draftId: 'nope',
          expected_input_version: 'x',
          personIds: [SUBJECT],
          projectId: null,
        })
      ).status,
    ).toBe('not_found');
  });

  it('keeps jobs across reloads and reads no stored sources', async () => {
    const first = server('normal', sessionStorage);
    const started = await first.actions.start(input());
    if (started.status !== 'success') throw new Error();
    const again = server('normal', sessionStorage);
    expect((await again.read(started.result.jobId)).jobId).toBe(
      started.result.jobId,
    );
    await expect(again.read('nope')).rejects.toThrow();
    expect(
      await again.actions.loadSource({
        fragmentId: 'f',
        originalVersionId: 'v',
      }),
    ).toMatchObject({ status: 'not_found' });
    const anchors = await again.loadAnchors({
      personIds: [SUBJECT],
      ruleVersions: [],
    });
    expect(anchors[SUBJECT]?.mot?.ruleVersion).toBe('rubric-v1');
    expect(anchors[SUBJECT]?.prof?.levels[2]).toBe('达到本届学员预期');
  });

  it('starts over from broken storage', async () => {
    sessionStorage.setItem('qtalent-dev-record:p-suwan:normal', '{');
    const s = server('normal', sessionStorage);
    expect((await s.actions.start(input())).status).toBe('success');
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
        searchParams: Promise.resolve({ role: 'hr', scene: 'nope' }),
      }),
    ).rejects.toThrow('not-found');
    expect(
      await RecordSample({
        searchParams: Promise.resolve({ role: 'mentor', person: SUBJECT }),
      }),
    ).toBeTruthy();
  });

  it('puts the job in the URL while arranging, never the text', async () => {
    render(
      <ToastProvider>
        <SampleRecord
          role="hr"
          scene="normal"
          personId={null}
          handoff={false}
          jobId={null}
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
    expect(url).toMatch(/job=sample-job-\d+/);
    expect(decodeURIComponent(url)).not.toContain('开了个会');
  });
});
