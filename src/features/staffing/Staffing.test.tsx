// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type {
  StaffingCandidate,
  StaffingDemand,
  StaffingDemandJobSnapshot,
  StaffingJobSnapshot,
  StaffingPage,
} from '@/contracts/staffing';
import { staffingFixture } from '@/contracts/staffing.fixtures';
import { JobReadError } from '@/lib/job-subscription';
import type { StaffingPorts } from './ports';
import type { ProjectHead } from './view';
import { Staffing, failureText, withRequirement } from './Staffing';
import { STAFFING_DRAFT_KEY } from './draft';

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

const project: ProjectHead = {
  id: 'demo-project',
  name: '演示项目',
  goal: '演示：给服务端补一个负责人。',
  status: '筹备中',
};
const base = staffingFixture();
const source = base.candidates[0].requirements[0].aiJudgment!.sources[0];
const draft: StaffingDemand = {
  id: 'demo-demand',
  projectId: project.id,
  revision: 1,
  inputText: '演示：寻找服务端负责人',
  requirements: [
    { id: 'required-1', text: '独立交付模块', priority: 'required' },
    { id: 'bonus-1', text: '有语音经验', priority: 'bonus' },
  ],
  status: 'draft',
};
const confirm = (demand: StaffingDemand): StaffingDemand => ({
  id: demand.id,
  projectId: demand.projectId,
  inputText: demand.inputText,
  requirements: demand.requirements,
  revision: demand.revision + 1,
  status: 'confirmed',
  confirmedBy: { id: 'demo-hr', name: '演示审核人' },
  confirmedAt: '2026-09-04T02:00:00Z',
});
const confirmed = confirm(draft);

function candidate(
  id: string,
  matches: StaffingCandidate['requirements'],
): StaffingCandidate {
  return {
    person: { id, name: `演示${id}`, orgName: '演示部门' },
    demandRevision: confirmed.revision,
    requirements: matches,
  };
}
const supported = {
  requirementId: 'required-1',
  progress: 'completed' as const,
  aiJudgment: {
    conclusion: 'supported' as const,
    rationale: '演示：独立交付过对应模块',
    sources: [source],
  },
  humanJudgment: null,
};
const pageOf = (demand: StaffingDemand): StaffingPage => ({
  demand,
  candidates: [
    candidate('甲', [
      supported,
      {
        requirementId: 'bonus-1',
        progress: 'awaiting_manual',
        aiJudgment: null,
        humanJudgment: null,
      },
    ]),
    candidate('乙', [
      {
        requirementId: 'required-1',
        progress: 'failed',
        aiJudgment: null,
        humanJudgment: null,
      },
      {
        requirementId: 'bonus-1',
        progress: 'judging',
        aiJudgment: null,
        humanJudgment: null,
      },
    ]),
  ],
  plan: { status: 'not_connected' },
});

function job<K extends 'staffing_demand' | 'staffing_match', R>(
  kind: K,
  status: StaffingJobSnapshot['status'],
  result: R | null,
  jobId = `${kind}-job`,
) {
  return {
    schemaVersion: 1 as const,
    jobId,
    kind,
    status,
    attempt: 1,
    revision: 1,
    updatedAt: '2026-09-04T02:00:00Z',
    progress: null,
    result,
    error:
      status === 'failed'
        ? { code: 'processing_failed' as const, message: '演示：模型没有返回' }
        : null,
    canRetry: false,
    canCancel: false,
    cancelRequestedAt: null,
  };
}

function ports(overrides: Partial<StaffingPorts> = {}): StaffingPorts {
  return {
    createDemand: vi.fn(async () => ({
      status: 'success' as const,
      snapshot: job<'staffing_demand', StaffingDemand>(
        'staffing_demand',
        'queued',
        null,
      ),
      replayed: false,
    })),
    readDemandJob: vi.fn(async (): Promise<StaffingDemandJobSnapshot> =>
      job('staffing_demand', 'completed', draft),
    ),
    editDemand: vi.fn(async (input) => ({
      status: 'success' as const,
      demand: {
        ...draft,
        revision: input.expectedRevision + 1,
        requirements: input.requirements,
      },
      replayed: false,
    })),
    confirmDemand: vi.fn(async () => ({
      status: 'success' as const,
      demand: confirmed,
      replayed: false,
    })),
    openMatching: vi.fn(async () => 'staffing_match-job'),
    readMatchingJob: vi.fn(async (): Promise<StaffingJobSnapshot> =>
      job('staffing_match', 'awaiting_manual', pageOf(confirmed)),
    ),
    judge: vi.fn(async (input) => ({
      status: 'success' as const,
      demandId: input.demandId,
      personId: input.personId,
      revision: input.expectedRevision,
      match: {
        requirementId: input.requirementId,
        progress: 'completed' as const,
        aiJudgment: null,
        humanJudgment: {
          conclusion: input.conclusion,
          rationale: input.rationale,
          sources: input.sources.length ? [source] : [],
          judgedBy: { id: 'demo-hr', name: '演示审核人' },
          judgedAt: '2026-09-04T03:00:00Z',
        },
      },
      replayed: false,
    })),
    loadSource: vi.fn(async () => ({
      status: 'success' as const,
      source,
    })),
    ...overrides,
  };
}

const field = () => screen.getByRole('textbox', { name: '描述项目和要找的人' });
const card = (name: string) =>
  screen.getByRole('link', { name }).closest('article') as HTMLElement;

describe('entry and drafting', () => {
  it('sends the sentence, follows the drafting job and shows the demand card', async () => {
    const p = ports();
    render(
      <Staffing project={project} demand={null} accountId="me" ports={p} />,
    );
    expect(
      screen.getByRole('heading', { name: '为一个项目或关键岗位找人' }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '开始' }));
    expect(p.createDemand).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: '智能体平台应用后端要找一个 owner' }),
    );
    expect(field()).toHaveProperty('value', '智能体平台应用后端要找一个 owner');
    fireEvent.keyDown(field(), { key: 'Enter', metaKey: true });
    await screen.findByRole('heading', { name: '为「演示项目」找人' });
    expect(p.createDemand).toHaveBeenCalledWith({
      operationId: expect.any(String),
      inputText: '智能体平台应用后端要找一个 owner',
    });
    expect(screen.getByText('来自：「演示：寻找服务端负责人」')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /候选人/ })).toBeNull();
    expect(p.openMatching).not.toHaveBeenCalled();
  });

  it('hands the drafted demand to the page when no project is bound yet', async () => {
    const onDemandReady = vi.fn();
    render(
      <Staffing
        project={null}
        demand={null}
        accountId="me"
        ports={ports()}
        onDemandReady={onDemandReady}
      />,
    );
    fireEvent.change(field(), { target: { value: '找一个负责人' } });
    fireEvent.click(screen.getByRole('button', { name: '开始' }));
    await waitFor(() => expect(onDemandReady).toHaveBeenCalledWith(draft));
    expect(screen.getByText('起草需求卡 · 2 步')).toBeTruthy();
  });

  it('reports the drafting job and the drafted demand for the address', async () => {
    const onJobStarted = vi.fn();
    const onDemandReady = vi.fn();
    render(
      <Staffing
        project={project}
        demand={null}
        accountId="me"
        ports={ports()}
        onJobStarted={onJobStarted}
        onDemandReady={onDemandReady}
      />,
    );
    fireEvent.change(field(), { target: { value: '找一个负责人' } });
    fireEvent.click(screen.getByRole('button', { name: '开始' }));
    await screen.findByRole('heading', { name: '为「演示项目」找人' });
    expect(onJobStarted).toHaveBeenCalledWith('staffing_demand-job');
    expect(onDemandReady).toHaveBeenCalledWith(draft);
  });

  it('follows a drafting job sent before the page loaded, without its sentence', async () => {
    const p = ports({
      readDemandJob: vi.fn(async () =>
        job<'staffing_demand', StaffingDemand>(
          'staffing_demand',
          'running',
          null,
          'earlier-job',
        ),
      ),
    });
    render(
      <Staffing
        project={project}
        demand={null}
        resumeJobId="earlier-job"
        accountId="me"
        ports={p}
      />,
    );
    expect(
      screen
        .getByRole('heading', { name: '为一个项目找人' })
        .parentElement?.querySelector('p'),
    ).toBeNull();
    await waitFor(() =>
      expect(p.readDemandJob).toHaveBeenCalledWith(
        'earlier-job',
        expect.any(AbortSignal),
      ),
    );
    expect(p.createDemand).not.toHaveBeenCalled();
  });

  it('keeps the sentence and says why when sending is refused', async () => {
    const createDemand = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'validation_error',
        fieldErrors: { inputText: ['请再具体一点'] },
        input: {},
      })
      .mockResolvedValueOnce({
        status: 'forbidden',
        message: '演示：无权限',
        input: {},
      })
      .mockRejectedValueOnce(new Error('offline'));
    render(
      <Staffing
        project={project}
        demand={null}
        accountId="me"
        ports={ports({ createDemand })}
      />,
    );
    fireEvent.change(field(), { target: { value: '找人' } });
    for (const message of [
      '请再具体一点',
      // The page's own wording, not the server's.
      '这份需求现在在你的查看范围之外，刷新后按当前权限查看',
      '保存失败，请检查网络后再试一次',
    ]) {
      fireEvent.click(screen.getByRole('button', { name: '开始' }));
      expect((await screen.findByRole('alert')).textContent).toBe(message);
      expect(field()).toHaveProperty('value', '找人');
    }
  });

  it('shows a failed drafting step and returns to the sentence', async () => {
    render(
      <Staffing
        project={project}
        demand={null}
        accountId="me"
        ports={ports({
          readDemandJob: vi.fn(async () =>
            job<'staffing_demand', StaffingDemand>(
              'staffing_demand',
              'failed',
              null,
            ),
          ),
        })}
      />,
    );
    fireEvent.change(field(), { target: { value: '找一个负责人' } });
    fireEvent.click(screen.getByRole('button', { name: '开始' }));
    await screen.findByText('演示：模型没有返回');
    fireEvent.click(screen.getByRole('button', { name: '回到输入框' }));
    expect(field()).toHaveProperty('value', '找一个负责人');
  });

  it('starts from the workbench sentence once, for the same account only', () => {
    window.sessionStorage.setItem(
      STAFFING_DRAFT_KEY,
      JSON.stringify({
        accountId: 'me',
        text: '从工作台来的一句话',
        savedAt: Date.now(),
      }),
    );
    render(
      <Staffing
        project={null}
        demand={null}
        accountId="me"
        fromWorkbench
        ports={ports()}
      />,
    );
    expect(field()).toHaveProperty('value', '从工作台来的一句话');
    expect(window.sessionStorage.getItem(STAFFING_DRAFT_KEY)).toBeNull();
    cleanup();
    render(
      <Staffing
        project={null}
        demand={null}
        accountId="other"
        fromWorkbench
        ports={ports()}
      />,
    );
    expect(field()).toHaveProperty('value', '');
    cleanup();
    // A sentence handed over later replaces the one taken before.
    window.sessionStorage.setItem(
      STAFFING_DRAFT_KEY,
      JSON.stringify({
        accountId: 'me',
        text: '又一句话',
        savedAt: Date.now(),
      }),
    );
    render(
      <Staffing
        project={null}
        demand={null}
        accountId="me"
        fromWorkbench
        ports={ports()}
      />,
    );
    expect(field()).toHaveProperty('value', '又一句话');
  });
});

describe('demand card', () => {
  it('toggles a requirement, adds one before the bonus items and confirms', async () => {
    const p = ports();
    render(
      <Staffing project={project} demand={draft} accountId="me" ports={p} />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: '有语音经验：加分，切换为必须项' }),
    );
    await waitFor(() =>
      expect(p.editDemand).toHaveBeenCalledWith({
        operationId: expect.any(String),
        demandId: draft.id,
        expectedRevision: 1,
        requirements: [
          draft.requirements[0],
          { ...draft.requirements[1], priority: 'required' },
        ],
      }),
    );
    await screen.findByRole('button', {
      name: '有语音经验：必须，切换为加分项',
    });

    const add = screen.getByRole('textbox', { name: '补一句要求' });
    fireEvent.change(add, { target: { value: '独立交付模块' } });
    fireEvent.click(screen.getByRole('button', { name: '加上' }));
    expect(add).toHaveProperty('value', '');
    expect(p.editDemand).toHaveBeenCalledTimes(1);
    fireEvent.change(add, { target: { value: '10 月能到岗' } });
    fireEvent.keyDown(add, { key: 'Enter' });
    await waitFor(() => expect(add).toHaveProperty('value', ''));
    expect(
      [...document.querySelectorAll('#reqs li')].map((li) => li.textContent),
    ).toEqual(['必须独立交付模块', '必须有语音经验', '必须10 月能到岗']);

    fireEvent.click(screen.getByRole('button', { name: '确认需求' }));
    await screen.findByText('演示审核人 09-04 确认 · 按这版要求核对候选人');
    expect(p.confirmDemand).toHaveBeenCalledWith({
      operationId: expect.any(String),
      demandId: draft.id,
      expectedRevision: 3,
    });
    expect(p.openMatching).toHaveBeenCalledWith({
      demandId: confirmed.id,
      revision: confirmed.revision,
    });
    await screen.findByText('2 人进入候选 · 按必须项的证据排列');
  });

  it('keeps the typed requirement when saving fails', async () => {
    const editDemand = vi
      .fn()
      .mockResolvedValueOnce({ status: 'conflict', message: 'x', input: {} })
      .mockRejectedValueOnce(new Error('offline'));
    render(
      <Staffing
        project={project}
        demand={draft}
        accountId="me"
        ports={ports({ editDemand })}
      />,
    );
    const add = screen.getByRole('textbox', { name: '补一句要求' });
    fireEvent.change(add, { target: { value: '能带新人' } });
    fireEvent.click(screen.getByRole('button', { name: '加上' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      '需求已变化，请保留输入并刷新',
    );
    expect(add).toHaveProperty('value', '能带新人');
    fireEvent.click(screen.getByRole('button', { name: '加上' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        '保存失败，请检查网络后再试一次',
      ),
    );
  });
});

describe('candidates', () => {
  it('shows the four states, progress and failure apart, with sources that open', async () => {
    const p = ports();
    render(
      <Staffing
        project={project}
        demand={confirmed}
        matchingJobId="staffing_match-job"
        accountId="me"
        ports={p}
      />,
    );
    const first = await screen.findByRole('link', { name: '演示甲' });
    expect(p.openMatching).not.toHaveBeenCalled();
    const a = card('演示甲');
    expect(
      a.querySelector('[data-req="required-1"]')?.getAttribute('data-s'),
    ).toBe('yes');
    expect(within(a).getByText('待人工判断')).toBeTruthy();
    expect(within(a).getByText('（加分项）')).toBeTruthy();
    const b = card('演示乙');
    expect(within(b).getByText('失败')).toBeTruthy();
    expect(within(b).getByText('判断中')).toBeTruthy();
    expect(b.querySelector('[data-s]')).toBeNull();
    expect(screen.getByText('条件待确认 · 0 人')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/总分|胜任率|%/);
    expect(first.getAttribute('href')).toBe('/person?id=%E7%94%B2');

    fireEvent.click(within(a).getByRole('button', { name: /引用 1/ }));
    await waitFor(() =>
      expect(p.loadSource).toHaveBeenCalledWith({
        fragmentId: source.fragmentId,
        originalVersionId: source.originalVersionId,
      }),
    );
  });

  it('judges a waiting requirement by hand and signs it', async () => {
    const p = ports();
    render(
      <Staffing
        project={project}
        demand={confirmed}
        matchingJobId="staffing_match-job"
        accountId="me"
        ports={p}
      />,
    );
    await screen.findByRole('link', { name: '演示甲' });
    fireEvent.click(screen.getByRole('button', { name: '人工判断' }));
    const form = screen.getByRole('group', { name: /这条要求要你来判断/ });
    expect(document.activeElement).toBe(
      within(form).getByRole('button', { name: '支持' }),
    );
    const confirmButton = within(form).getByRole('button', {
      name: '署名确认',
    });
    fireEvent.click(within(form).getByRole('button', { name: '支持' }));
    fireEvent.change(within(form).getByRole('textbox'), {
      target: { value: '演示：项目里做过语音' },
    });
    expect(confirmButton).toHaveProperty('disabled', true);
    fireEvent.click(within(form).getByRole('checkbox'));
    expect(confirmButton).toHaveProperty('disabled', false);
    fireEvent.click(confirmButton);
    await screen.findByText('演示审核人 · 09-04');
    expect(p.judge).toHaveBeenCalledWith({
      operationId: expect.any(String),
      demandId: confirmed.id,
      expectedRevision: confirmed.revision,
      personId: '甲',
      requirementId: 'bonus-1',
      conclusion: 'supported',
      rationale: '演示：项目里做过语音',
      sources: [
        {
          fragmentId: source.fragmentId,
          originalVersionId: source.originalVersionId,
          location: source.location,
        },
      ],
    });
    expect(
      screen.queryByRole('group', { name: /这条要求要你来判断/ }),
    ).toBeNull();
    expect(screen.getByText('人工结论')).toBeTruthy();
  });

  it('keeps the form open with the reason when judging fails, and can cancel', async () => {
    const judge = vi
      .fn()
      .mockResolvedValueOnce({ status: 'conflict', message: 'x', input: {} })
      .mockRejectedValueOnce(new Error('offline'));
    render(
      <Staffing
        project={project}
        demand={confirmed}
        matchingJobId="staffing_match-job"
        accountId="me"
        ports={ports({ judge })}
      />,
    );
    await screen.findByRole('link', { name: '演示甲' });
    fireEvent.click(screen.getByRole('button', { name: '人工判断' }));
    const form = screen.getByRole('group', { name: /这条要求要你来判断/ });
    fireEvent.click(within(form).getByRole('button', { name: '资料不足' }));
    fireEvent.change(within(form).getByRole('textbox'), {
      target: { value: '演示：没有到岗记录' },
    });
    fireEvent.click(within(form).getByRole('button', { name: '署名确认' }));
    expect((await within(form).findByRole('alert')).textContent).toBe(
      '需求已变化，请保留输入并刷新',
    );
    expect(judge.mock.calls[0][0]).toMatchObject({
      conclusion: 'insufficient',
      sources: [],
    });
    fireEvent.click(within(form).getByRole('button', { name: '署名确认' }));
    await waitFor(() =>
      expect(within(form).getByRole('alert').textContent).toBe(
        '保存失败，请检查网络后再试一次',
      ),
    );
    expect(within(form).getByRole('textbox')).toHaveProperty(
      'value',
      '演示：没有到岗记录',
    );
    fireEvent.click(within(form).getByRole('button', { name: '取消' }));
    expect(
      screen.queryByRole('group', { name: /这条要求要你来判断/ }),
    ).toBeNull();
  });

  it('offers only 资料不足 when the candidate has nothing to cite', async () => {
    const page = pageOf(confirmed);
    page.candidates = [
      candidate('丙', [
        {
          requirementId: 'required-1',
          progress: 'awaiting_manual',
          aiJudgment: null,
          humanJudgment: null,
        },
        {
          requirementId: 'bonus-1',
          progress: 'completed',
          aiJudgment: {
            conclusion: 'insufficient',
            rationale: '演示：没有记录',
            sources: [],
          },
          humanJudgment: null,
        },
      ]),
    ];
    render(
      <Staffing
        project={project}
        demand={confirmed}
        matchingJobId="staffing_match-job"
        accountId="me"
        ports={ports({
          readMatchingJob: vi.fn(async () =>
            job('staffing_match', 'awaiting_manual', page),
          ),
        })}
      />,
    );
    await screen.findByRole('link', { name: '演示丙' });
    fireEvent.click(screen.getByRole('button', { name: '人工判断' }));
    const form = screen.getByRole('group', { name: /这条要求要你来判断/ });
    expect(within(form).getByRole('button', { name: '支持' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(
      within(form).getByRole('button', { name: '资料不足' }),
    ).toHaveProperty('disabled', false);
    expect(within(form).getByText(/来源待补充/)).toBeTruthy();
  });

  it('says when matching is not connected, still running, failed or not visible', async () => {
    const cases: [Partial<StaffingPorts>, string][] = [
      [{ openMatching: vi.fn(async () => null) }, '候选人核对待接通'],
      [
        { openMatching: vi.fn(async () => Promise.reject(new Error('x'))) },
        '候选人核对待接通',
      ],
      [
        {
          readMatchingJob: vi.fn(async () =>
            job<'staffing_match', StaffingPage>(
              'staffing_match',
              'failed',
              null,
            ),
          ),
        },
        '候选人核对中断',
      ],
      [
        {
          readMatchingJob: vi.fn(async () =>
            Promise.reject(new JobReadError(403)),
          ),
        },
        '这次核对在你的查看范围之外',
      ],
      [
        {
          readMatchingJob: vi.fn(async () =>
            job(
              'staffing_match',
              'running',
              pageOf({ ...confirmed, revision: 9 }),
            ),
          ),
        },
        '候选人核对中',
      ],
    ];
    for (const [overrides, text] of cases) {
      render(
        <Staffing
          project={project}
          demand={confirmed}
          accountId="me"
          ports={ports(overrides)}
        />,
      );
      await screen.findByText(text);
      cleanup();
    }
  });

  it('lists people short of evidence under 条件待确认 and handles no candidates', async () => {
    const insufficient = (requirementId: string) => ({
      requirementId,
      progress: 'completed' as const,
      aiJudgment: {
        conclusion: 'insufficient' as const,
        rationale: '演示',
        sources: [],
      },
      humanJudgment: null,
    });
    const both = {
      ...confirmed,
      requirements: confirmed.requirements.map((item) => ({
        ...item,
        priority: 'required' as const,
      })),
    };
    const page: StaffingPage = {
      demand: both,
      candidates: [
        candidate('丁', [insufficient('required-1'), insufficient('bonus-1')]),
      ],
      plan: { status: 'not_connected' },
    };
    render(
      <Staffing
        project={project}
        demand={both}
        matchingJobId="staffing_match-job"
        accountId="me"
        ports={ports({
          readMatchingJob: vi.fn(async () =>
            job('staffing_match', 'completed', page),
          ),
        })}
      />,
    );
    await screen.findByText('条件待确认 · 1 人');
    expect(screen.getByText('独立交付模块、有语音经验资料不足')).toBeTruthy();
    expect(screen.getByText('换个条件再找')).toBeTruthy();
  });

  it('clears candidates after the requirements change until confirmed again', async () => {
    const p = ports();
    render(
      <Staffing
        project={project}
        demand={confirmed}
        matchingJobId="staffing_match-job"
        accountId="me"
        ports={p}
      />,
    );
    await screen.findByRole('link', { name: '演示甲' });
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: '有语音经验：加分，切换为必须项' }),
      );
    });
    await screen.findByRole('button', { name: '确认需求' });
    expect(screen.queryByRole('link', { name: '演示甲' })).toBeNull();
  });
});

describe('first-round review fixes', () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }
  const pageAt = (demand: StaffingDemand): StaffingPage => {
    const page = pageOf(demand);
    return {
      ...page,
      candidates: page.candidates.map((item) => ({
        ...item,
        demandRevision: demand.revision,
      })),
    };
  };

  it('ends the drafting trail when the job can no longer be read, keeping the sentence', async () => {
    const notes = new Map([
      [401, '登录已失效，重新登录后回到输入框再发一次。'],
      [403, '起草结果现在在你的查看范围之外，可以回到输入框再发一次。'],
      [404, '这次起草的记录已失效，回到输入框再发一次。'],
    ]);
    for (const [status, note] of notes) {
      render(
        <Staffing
          project={project}
          demand={null}
          accountId="me"
          ports={ports({
            readDemandJob: vi.fn(async () =>
              Promise.reject(new JobReadError(status)),
            ),
          })}
        />,
      );
      fireEvent.change(field(), { target: { value: `找人 ${status}` } });
      fireEvent.click(screen.getByRole('button', { name: '开始' }));
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toBe(note);
      expect(alert.className).toBe('nt-field-error');
      expect(
        document.querySelector('.n-trail__step[data-state="failed"]'),
      ).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: '回到输入框' }));
      expect(field()).toHaveProperty('value', `找人 ${status}`);
      cleanup();
    }
  });

  it('says it is retrying while reading the drafting job fails for a moment', async () => {
    render(
      <Staffing
        project={project}
        demand={null}
        accountId="me"
        ports={ports({
          readDemandJob: vi.fn(async () =>
            Promise.reject(new JobReadError(500)),
          ),
        })}
      />,
    );
    fireEvent.change(field(), { target: { value: '找人' } });
    fireEvent.click(screen.getByRole('button', { name: '开始' }));
    await screen.findByText(/起草进度读取中断，正在重试/);
    expect(screen.getByRole('button', { name: '回到输入框' })).toBeTruthy();
  });

  it('opens a fresh judgment form for each waiting requirement of one person', async () => {
    const page = pageOf(confirmed);
    page.candidates = [
      candidate('甲', [
        { ...page.candidates[0].requirements[1], requirementId: 'required-1' },
        page.candidates[0].requirements[1],
      ]),
      candidate('乙', [supported, { ...supported, requirementId: 'bonus-1' }]),
    ];
    const p = ports({
      readMatchingJob: vi.fn(async () =>
        job('staffing_match', 'awaiting_manual', page),
      ),
    });
    render(
      <Staffing
        project={project}
        demand={confirmed}
        matchingJobId="staffing_match-job"
        accountId="me"
        ports={p}
      />,
    );
    await screen.findByRole('link', { name: '演示甲' });
    const a = card('演示甲');
    fireEvent.click(within(a).getAllByRole('button', { name: '人工判断' })[0]);
    let form = screen.getByRole('group', { name: /这条要求要你来判断/ });
    fireEvent.click(within(form).getByRole('button', { name: '资料不足' }));
    fireEvent.change(within(form).getByRole('textbox'), {
      target: { value: '演示：第一条的理由' },
    });
    fireEvent.click(within(a).getByRole('button', { name: '人工判断' }));
    form = screen.getByRole('group', { name: /这条要求要你来判断/ });
    expect(form.textContent).toContain('有语音经验');
    expect(within(form).getByRole('textbox')).toHaveProperty('value', '');
    expect(
      within(form)
        .getAllByRole('button')
        .some((button) => button.getAttribute('aria-pressed') === 'true'),
    ).toBe(false);
    expect(p.judge).not.toHaveBeenCalled();
  });

  it('drops a judgment answer that arrives after the demand changed', async () => {
    const answer = deferred<Awaited<ReturnType<StaffingPorts['judge']>>>();
    let latest: StaffingDemand = confirmed;
    const p = ports({
      judge: vi.fn(() => answer.promise),
      confirmDemand: vi.fn(async (input) => {
        latest = {
          ...confirmed,
          revision: input.expectedRevision + 1,
        };
        return { status: 'success' as const, demand: latest, replayed: false };
      }),
      openMatching: vi.fn(async ({ revision }) => `match-${revision}`),
      readMatchingJob: vi.fn(async (jobId) =>
        job('staffing_match', 'awaiting_manual', pageAt(latest), jobId),
      ),
    });
    render(
      <Staffing
        project={project}
        demand={confirmed}
        accountId="me"
        ports={p}
      />,
    );
    await screen.findByRole('link', { name: '演示甲' });
    fireEvent.click(screen.getByRole('button', { name: '人工判断' }));
    const form = screen.getByRole('group', { name: /这条要求要你来判断/ });
    fireEvent.click(within(form).getByRole('button', { name: '资料不足' }));
    fireEvent.change(within(form).getByRole('textbox'), {
      target: { value: '演示：旧版本的理由' },
    });
    fireEvent.click(within(form).getByRole('button', { name: '署名确认' }));
    await waitFor(() => expect(p.judge).toHaveBeenCalled());

    fireEvent.click(
      screen.getByRole('button', { name: '有语音经验：加分，切换为必须项' }),
    );
    fireEvent.click(await screen.findByRole('button', { name: '确认需求' }));
    await screen.findByText('演示审核人 09-04 确认 · 按这版要求核对候选人');
    await screen.findByRole('link', { name: '演示甲' });
    expect(latest.revision).toBe(4);

    await act(async () => {
      answer.resolve({
        status: 'success',
        demandId: confirmed.id,
        personId: '甲',
        revision: confirmed.revision,
        match: {
          requirementId: 'bonus-1',
          progress: 'completed',
          aiJudgment: null,
          humanJudgment: {
            conclusion: 'insufficient',
            rationale: '演示：旧版本的理由',
            sources: [],
            judgedBy: { id: 'demo-hr', name: '演示审核人' },
            judgedAt: '2026-09-04T03:00:00Z',
          },
        },
        replayed: false,
      });
    });
    expect(screen.queryByText('演示：旧版本的理由')).toBeNull();
    expect(within(card('演示甲')).getByText('待人工判断')).toBeTruthy();
  });

  it('keeps the keyboard focus while saving and moves it to the confirmed line', async () => {
    const saved = deferred<Awaited<ReturnType<StaffingPorts['editDemand']>>>();
    render(
      <Staffing
        project={project}
        demand={draft}
        accountId="me"
        ports={ports({ editDemand: vi.fn(() => saved.promise) })}
      />,
    );
    // Before confirming nothing is matched yet: only the confirm caption is shown.
    expect(
      screen.getByText('确认后开始核对候选人；改了要求要重新确认。'),
    ).toBeTruthy();
    expect(
      screen.queryByText('改了要求，候选人会按新要求重新核对。'),
    ).toBeNull();
    const toggle = screen.getByRole('button', {
      name: '有语音经验：加分，切换为必须项',
    });
    toggle.focus();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-disabled')).toBe('true');
    expect(toggle).toHaveProperty('disabled', false);
    expect(document.activeElement).toBe(toggle);
    const confirm = screen.getByRole('button', { name: '确认需求' });
    expect(confirm.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(confirm);
    await act(async () => {
      saved.resolve({
        status: 'success',
        demand: {
          ...draft,
          revision: 2,
          requirements: draft.requirements.map((item) => ({
            ...item,
            priority: 'required' as const,
          })),
        },
        replayed: false,
      });
    });
    expect(document.activeElement).toBe(toggle);
    expect(toggle.getAttribute('aria-disabled')).toBe('false');

    screen.getByRole('button', { name: '确认需求' }).focus();
    fireEvent.click(screen.getByRole('button', { name: '确认需求' }));
    const line = await screen.findByText(
      '演示审核人 09-04 确认 · 按这版要求核对候选人',
    );
    expect(document.activeElement).toBe(line);
    expect(
      screen.getByText('改了要求，候选人会按新要求重新核对。'),
    ).toBeTruthy();
  });

  it('keeps what is typed while an added requirement is being saved', async () => {
    const saved = deferred<Awaited<ReturnType<StaffingPorts['editDemand']>>>();
    render(
      <Staffing
        project={project}
        demand={draft}
        accountId="me"
        ports={ports({ editDemand: vi.fn(() => saved.promise) })}
      />,
    );
    const add = screen.getByRole('textbox', { name: '补一句要求' });
    fireEvent.change(add, { target: { value: '能带新人' } });
    fireEvent.click(screen.getByRole('button', { name: '加上' }));
    fireEvent.change(add, { target: { value: '能带新人和值班' } });
    await act(async () => {
      saved.resolve({
        status: 'success',
        demand: {
          ...draft,
          revision: 2,
          requirements: withRequirement(draft.requirements, '能带新人'),
        },
        replayed: false,
      });
    });
    expect(add).toHaveProperty('value', '能带新人和值班');
  });
});

describe('helpers', () => {
  it('words refusals for the viewer', () => {
    expect(failureText({ status: 'conflict', message: 'x' })).toBe(
      '需求已变化，请保留输入并刷新',
    );
    expect(failureText({ status: 'forbidden', message: '服务端原文' })).toBe(
      '这份需求现在在你的查看范围之外，刷新后按当前权限查看',
    );
    expect(failureText({ status: 'not_found', message: '演示：不存在' })).toBe(
      '演示：不存在',
    );
    expect(failureText({ status: 'validation_error', fieldErrors: {} })).toBe(
      '保存失败，请检查后再试一次',
    );
  });

  it('appends a requirement when there are no bonus items', () => {
    const only = [draft.requirements[0]];
    expect(withRequirement(only, '新要求').map((item) => item.text)).toEqual([
      '独立交付模块',
      '新要求',
    ]);
  });
});
