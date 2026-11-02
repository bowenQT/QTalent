// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { staffingPageSchema, staffingDemandSchema } from '@/contracts/staffing';
import { sourceSchema } from '@/contracts/sources';
import StaffingSample from './page';
import { samplePorts } from './sample-ports';
import { newDraft, newMatching, samplePages, sampleSources } from './samples';

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not-found');
  },
  usePathname: () => '/dev/staffing',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const sample = (role?: string, scene?: string) =>
  StaffingSample({ searchParams: Promise.resolve({ role, scene }) });
const actor = { id: 'sample-hr', name: '苏晚' };
const signal = new AbortController().signal;

describe('staffing sample route', () => {
  it('answers 404 in a production build and for unknown parameters', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await expect(sample('hr', 'ts')).rejects.toThrow('not-found');
    vi.stubEnv('NODE_ENV', 'development');
    await expect(sample('mentor', 'ts')).rejects.toThrow('not-found');
    await expect(sample('hr', 'other')).rejects.toThrow('not-found');
  });

  it('renders the project scenes inside the shell', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    render(await sample('hr', 'ts'));
    expect(
      screen.getByRole('heading', { name: '为「业务成功部 TS 新人组」找人' }),
    ).toBeTruthy();
    await screen.findByText('4 人进入候选 · 按必须项的证据排列');
    cleanup();
    render(await sample('manager', 'new'));
    expect(
      screen.getByRole('heading', { name: '为一个项目或关键岗位找人' }),
    ).toBeTruthy();
  });
});

describe('sample data', () => {
  it('follows the staffing contract', () => {
    for (const page of Object.values(samplePages))
      expect(staffingPageSchema.safeParse(page).success).toBe(true);
    expect(staffingDemandSchema.safeParse(newDraft).success).toBe(true);
    for (const settled of [false, true])
      expect(
        staffingPageSchema.safeParse(
          newMatching({ ...newDraft, revision: 1 }, settled),
        ).success,
      ).toBe(true);
    for (const source of sampleSources.values())
      expect(sourceSchema.safeParse(source).success).toBe(true);
  });
});

describe('sample ports', () => {
  it('walks drafting, editing, confirming, matching and judging', async () => {
    const ports = samplePorts('new', actor, 0);
    const created = await ports.createDemand({
      operationId: 'op',
      inputText: '找人',
    });
    if (created.status !== 'success') throw new Error('expected success');
    const jobId = created.snapshot.jobId;
    expect((await ports.readDemandJob(jobId, signal)).status).toBe('running');
    const drafted = await ports.readDemandJob(jobId, signal);
    expect(drafted.result).toEqual({ ...newDraft, inputText: '找人' });

    const stale = await ports.editDemand({
      operationId: 'e0',
      demandId: newDraft.id,
      expectedRevision: 9,
      requirements: newDraft.requirements,
    });
    expect(stale.status).toBe('conflict');
    const edited = await ports.editDemand({
      operationId: 'e1',
      demandId: newDraft.id,
      expectedRevision: 1,
      requirements: newDraft.requirements.slice(0, 3),
    });
    expect(edited).toMatchObject({
      status: 'success',
      demand: { revision: 2 },
    });
    const done = await ports.confirmDemand({
      operationId: 'c1',
      demandId: newDraft.id,
      expectedRevision: 2,
    });
    expect(done).toMatchObject({
      status: 'success',
      demand: { revision: 3, status: 'confirmed', confirmedBy: actor },
    });
    expect(
      (
        await ports.confirmDemand({
          operationId: 'c2',
          demandId: newDraft.id,
          expectedRevision: 3,
        })
      ).status,
    ).toBe('conflict');

    const matchId = await ports.openMatching({
      demandId: newDraft.id,
      revision: 3,
    });
    expect(matchId).toBe('sample-match-sample-demand-new-3');
    expect((await ports.readMatchingJob(matchId!, signal)).status).toBe(
      'running',
    );
    const settled = await ports.readMatchingJob(matchId!, signal);
    expect(settled.status).toBe('awaiting_manual');
    expect(staffingPageSchema.safeParse(settled.result).success).toBe(true);

    const [cited] = sampleSources.values();
    const judged = await ports.judge(matchId!, {
      operationId: 'j1',
      demandId: newDraft.id,
      expectedRevision: 3,
      personId: 'p-x07',
      requirementId: 'r3',
      conclusion: 'supported',
      rationale: '演示',
      sources: [cited, { ...cited, fragmentId: 'missing' }].map(
        ({ fragmentId, originalVersionId, location }) => ({
          fragmentId,
          originalVersionId,
          location,
        }),
      ),
    });
    expect(judged).toMatchObject({
      status: 'success',
      match: { humanJudgment: { judgedBy: actor, sources: [cited] } },
    });
    expect(
      (
        await ports.judge(matchId!, {
          operationId: 'j2',
          demandId: newDraft.id,
          expectedRevision: 1,
          personId: 'p-x07',
          requirementId: 'r3',
          conclusion: 'insufficient',
          rationale: '演示',
          sources: [],
        })
      ).status,
    ).toBe('conflict');

    expect(await ports.loadSource(cited)).toEqual({
      status: 'success',
      source: cited,
    });
    expect(
      (
        await ports.loadSource({
          fragmentId: cited.fragmentId,
          originalVersionId: 'other',
        })
      ).status,
    ).toBe('not_found');
  });

  it('returns the prepared page for a project scene and refuses edits before drafting', async () => {
    const ports = samplePorts('agent', actor, 0);
    const page = await ports.readMatchingJob('m', signal);
    expect(page.result).toBe(samplePages.agent);
    const empty = samplePorts('new', actor, 0);
    expect(
      (
        await empty.editDemand({
          operationId: 'e',
          demandId: 'x',
          expectedRevision: 1,
          requirements: newDraft.requirements,
        })
      ).status,
    ).toBe('conflict');
    await expect(empty.readMatchingJob('m', signal)).rejects.toThrow(
      'No demand to match',
    );
  });

  it('lets the sample page reach the drafted card', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    render(await sample('manager', 'new'));
    fireEvent.change(
      screen.getByRole('textbox', { name: '描述项目和要找的人' }),
      {
        target: { value: '找人' },
      },
    );
    fireEvent.click(screen.getByRole('button', { name: '开始' }));
    await screen.findByRole(
      'heading',
      { name: '为「语音硬件 · 端云联调」找人' },
      { timeout: 4000 },
    );
  });
});
