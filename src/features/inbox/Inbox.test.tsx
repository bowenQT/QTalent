// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { ToastProvider } from '@/components/ui/Toast';
import { materialReviewResolvedItemSchema } from '@/contracts/material-review';
import { samplePorts } from '@/app/dev/inbox/sample-ports';
import { sampleData } from '@/app/dev/inbox/samples';
import { Inbox } from './Inbox';
import type { InboxData, InboxPorts } from './ports';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function show(data: InboxData, ports: InboxPorts = samplePorts(data)) {
  const view = render(
    <ToastProvider>
      <Inbox initial={data} ports={ports} />
    </ToastProvider>,
  );
  return { ...view, ports };
}
const card = (id: string) => document.getElementById(id) as HTMLElement;
const choose = (id: string, name: string | RegExp) =>
  fireEvent.click(within(card(id)).getByRole('button', { name }));
const toast = () => document.querySelector('.nt-toasts') as HTMLElement;
const aside = (title: string) =>
  screen.getByRole('heading', { name: new RegExp(`^${title}`) })
    .parentElement as HTMLElement;

describe('cards', () => {
  it('asks one question per item, with the kind, place and choices', () => {
    show(sampleData('hr'));
    expect(screen.getAllByRole('article').filter((a) => a.id)).toHaveLength(5);
    const speaker = card('i-spk');
    expect(speaker.textContent).toContain('待核对 · 说话人 · 16:30');
    expect(speaker.textContent).toContain('录像里的这位说话人是谁？');
    expect(speaker.querySelector('.n-cite__quote')?.textContent).toBe(
      '时间轴拖的时候按帧吸附，前后各留两帧的容差。',
    );
    expect(
      within(speaker)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['季季叙白', '周周初晴', '?都不是，稍后处理']);
    expect(card('i-xz').textContent).toContain('「小周」指谁？');
    expect(card('i-int').textContent).toContain(
      '关联到目录里的人以后，面评那一行才能导入。',
    );
    // The interviewer card has no「名单外」: only directory people or later.
    expect(card('i-int').textContent).not.toContain('名单外');
  });

  it('keeps the parts without a read or command visible and disabled', () => {
    show(sampleData('hr'));
    const scope = within(card('i-region')).getByRole('button', {
      name: /整理框出的范围/,
    });
    expect(scope).toHaveProperty('disabled', true);
    expect(scope.textContent).toContain('框选范围待接通');
    for (const field of document.querySelectorAll('input'))
      expect(field.disabled).toBe(true);
    expect(within(card('i-int')).getByLabelText('在人员目录里找')).toBeTruthy();
    expect(within(card('i-aze')).getByLabelText('在名单里找')).toBeTruthy();
  });

  it('shows the mentor only the items of their own materials', () => {
    show(sampleData('mentor'));
    expect(card('i-spk')).toBeTruthy();
    expect(card('i-xz')).toBeTruthy();
    expect(document.getElementById('i-int')).toBeNull();
    expect(document.getElementById('i-region')).toBeNull();
  });

  it('filters by kind with counts of open items', () => {
    show(sampleData('hr'));
    const chips = screen.getByRole('group', { name: '按类型筛选' });
    expect(
      within(chips)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['全部5', '说话人1', '未知人员2', '图片范围1', '面试官1']);
    fireEvent.click(within(chips).getByRole('button', { name: /面试官/ }));
    expect(document.querySelectorAll('.n-verify')).toHaveLength(1);
    expect(card('i-int')).toBeTruthy();
  });

  it('hides the chips when only one kind is open', () => {
    const data = sampleData('hr');
    show({ ...data, items: data.items.filter((i) => i.kind === 'speaker') });
    expect(screen.queryByRole('group', { name: '按类型筛选' })).toBeNull();
  });
});

describe('picking', () => {
  it('takes effect at once and can be undone from the toast', async () => {
    const { ports } = show(sampleData('hr'));
    const undo = vi.spyOn(ports, 'undo');
    choose('i-spk', '季叙白');
    await screen.findByText('已归到季叙白');
    expect(document.getElementById('i-spk')).toBeNull();
    expect(aside('已核对').textContent).toContain(
      '录像里的这位说话人是谁 → 季叙白',
    );
    fireEvent.click(within(toast()).getByRole('button', { name: '撤销' }));
    await within(toast()).findByText('已撤销，回到待核对');
    expect(undo).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'undo',
        kind: 'speaker',
        itemId: 'i-spk',
        expectedRevision: 2,
      }),
    );
    expect(card('i-spk')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '已核对' })).toBeNull();
  });

  it.each([
    [
      'i-xz',
      '名单外的人',
      '已记下：名单外的人，只留在原件里',
      '名单外的人，只留在原件里',
    ],
    ['i-region', '整张只作附件', '这张图只作附件保存', '整张只作附件'],
    ['i-int', '许致远', '已关联到许致远，面评那一行可以导入了', '关联到许致远'],
    ['i-xz', '周初晴', '已归到周初晴', '周初晴'],
  ])('resolves %s with「%s」', async (id, name, done, result) => {
    show(sampleData('hr'));
    choose(id, new RegExp(name));
    await screen.findByText(done);
    expect(aside('已核对').textContent).toContain(result);
  });

  it('sends the typed command with the item revision', async () => {
    const data = sampleData('hr');
    const ports = samplePorts(data);
    const resolve = vi.spyOn(ports, 'resolve');
    show(data, ports);
    choose('i-int', /许致远/);
    await screen.findByText(/已关联到许致远/);
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'unknown_interviewer',
        batchId: 'd-iv',
        itemId: 'i-int',
        expectedRevision: 1,
        resolution: { action: 'link_existing_interviewer', personId: 's-28' },
      }),
    );
    expect(resolve.mock.calls[0][0].operationId).toMatch(/\S/);
  });

  it('puts「稍后处理」aside without an undo, and brings it back', async () => {
    show(sampleData('mentor'));
    choose('i-spk', '都不是，稍后处理');
    await screen.findByText('已放到稍后处理，待办里仍会保留');
    expect(within(toast()).queryByRole('button', { name: '撤销' })).toBeNull();
    const later = aside('稍后处理');
    expect(later.textContent).toContain('说话人 录像里的这位说话人是谁');
    expect(document.getElementById('i-spk')).toBeNull();
    fireEvent.click(within(later).getByRole('button', { name: '继续核对' }));
    expect(card('i-spk')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /^稍后处理/ })).toBeNull();
    // Picking the resumed item clears it from the local list as well.
    choose('i-spk', '周初晴');
    await screen.findByText('已归到周初晴');
    expect(screen.queryByRole('heading', { name: /^稍后处理/ })).toBeNull();
  });

  it('says what is left when everything open was put aside or resolved', async () => {
    const data = sampleData('mentor');
    show({ ...data, items: data.items.slice(0, 1) });
    choose('i-spk', '都不是，稍后处理');
    expect(
      await screen.findByRole('heading', { name: '现在没有要核对的' }),
    ).toBeTruthy();
    expect(
      screen.getByText('1 处放在了稍后处理，在右侧继续核对。'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '继续核对' }));
    choose('i-spk', '季叙白');
    expect(
      await screen.findByRole('heading', { name: '都核对完了' }),
    ).toBeTruthy();
  });

  it('names the kind when a filtered kind is all put aside', async () => {
    show(sampleData('hr'));
    fireEvent.click(
      within(screen.getByRole('group', { name: '按类型筛选' })).getByRole(
        'button',
        { name: /说话人/ },
      ),
    );
    choose('i-spk', '都不是，稍后处理');
    // The filter falls back to all once the kind has nothing open.
    await screen.findByText('已放到稍后处理，待办里仍会保留');
    expect(document.querySelectorAll('.n-verify')).toHaveLength(4);
  });
});

describe('failures keep the card and the question', () => {
  const failing = (result: Awaited<ReturnType<InboxPorts['resolve']>>) => {
    const data = sampleData('mentor');
    const ports = samplePorts(data);
    vi.spyOn(ports, 'resolve').mockResolvedValue(result);
    return show(data, ports);
  };
  it.each([
    [
      { status: 'conflict', message: 'x', input: {} },
      '这一处刚有变化，刷新后再选',
    ],
    [
      { status: 'forbidden', message: 'x' },
      '这一处现在在你的查看范围之外，刷新后按当前权限查看',
    ],
    [
      { status: 'not_found', message: 'x' },
      '这一处已经处理过或已移走，刷新后再看',
    ],
    [
      { status: 'validation_error', fieldErrors: {}, input: {} },
      '这次选择没有保存，请再选一次',
    ],
  ] as const)('%j', async (result, text) => {
    failing(result as never);
    choose('i-spk', '季叙白');
    expect((await within(card('i-spk')).findByRole('alert')).textContent).toBe(
      text,
    );
    expect(card('i-spk').querySelector('.is-picked')).toBeNull();
    expect(screen.queryByText('服务端')).toBeNull();
  });
  it('a dropped connection', async () => {
    const data = sampleData('mentor');
    const ports = samplePorts(data);
    vi.spyOn(ports, 'resolve').mockRejectedValue(new Error('offline'));
    show(data, ports);
    choose('i-spk', '季叙白');
    expect((await within(card('i-spk')).findByRole('alert')).textContent).toBe(
      '保存失败，请检查网络后再试一次',
    );
    // The next pick clears the old message.
    vi.mocked(ports.resolve).mockRestore();
    choose('i-spk', '季叙白');
    await screen.findByText('已归到季叙白');
  });
  it('ignores a second pick while one is settling', async () => {
    const data = sampleData('mentor');
    const ports = samplePorts(data);
    let release: () => void = () => undefined;
    const original = ports.resolve.bind(ports);
    const resolve = vi
      .spyOn(ports, 'resolve')
      .mockImplementation(
        (command) =>
          new Promise((done) => (release = () => done(original(command)))),
      );
    show(data, ports);
    choose('i-spk', '季叙白');
    expect(
      within(card('i-spk')).getByRole('button', { name: '季叙白' }).className,
    ).toContain('is-picked');
    expect(card('i-spk').getAttribute('aria-busy')).toBe('true');
    fireEvent.click(
      within(card('i-xz')).getByRole('button', { name: /周初晴/ }),
    );
    expect(resolve).toHaveBeenCalledTimes(1);
    await act(async () => release());
    await screen.findByText('已归到季叙白');
  });
});

describe('「已核对」', () => {
  const lockedData = (): InboxData => {
    const data = sampleData('hr');
    const base = {
      batchId: 'd-iv',
      evaluationNodeId: 'n',
      materialId: 'm-pdf',
      originalVersionId: 'm-pdf-v1',
      revision: 3,
      state: 'resolved',
      resolvedAt: '2026-09-04T01:00:00.000Z',
      auditId: 'a',
    };
    const pdf = {
      fragmentId: 'f',
      originalVersionId: 'm-pdf-v1',
      location: { kind: 'pdf', page: 2, textRange: { start: 0, end: 4 } },
    };
    return {
      ...data,
      resolvedItems: [
        materialReviewResolvedItemSchema.parse({
          ...base,
          itemId: 'r-imported',
          kind: 'unknown_interviewer',
          observedName: 'Lily',
          importRowId: 'row-1',
          source: pdf,
          undo: { status: 'blocked', reason: 'interview_row_imported' },
          resolution: { action: 'link_existing_interviewer', personId: 's-28' },
        }),
        materialReviewResolvedItemSchema.parse({
          ...base,
          itemId: 'r-confirmed',
          kind: 'unknown_person',
          observedName: '小林',
          source: null,
          undo: { status: 'blocked', reason: 'dependent_draft_confirmed' },
          resolution: { action: 'bind_people', personIds: ['p-x15'] },
        }),
        materialReviewResolvedItemSchema.parse({
          ...base,
          itemId: 'r-open',
          kind: 'image_scope',
          source: null,
          undo: { status: 'available' },
          resolution: { action: 'keep_attachment_only' },
        }),
      ],
    };
  };

  it('says why a result is kept, and offers undo only where it is available', () => {
    show(lockedData());
    const rows = within(aside('已核对')).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      '面试官 面评里的面试官「Lily」是谁 → 关联到许致远已随导入写进档案',
      '未知人员 「小林」指谁 → 周初晴建议分已确认',
      '图片范围 这张图里要整理哪一部分 → 整张只作附件撤销',
    ]);
    expect(within(rows[0]).queryByRole('button')).toBeNull();
    expect(within(rows[1]).queryByRole('button')).toBeNull();
  });

  it('tells the viewer when an undo is refused', async () => {
    const data = lockedData();
    const ports = samplePorts(data);
    vi.spyOn(ports, 'undo').mockResolvedValue({
      status: 'conflict',
      message: 'x',
      input: {} as never,
    });
    show(data, ports);
    fireEvent.click(
      within(aside('已核对')).getByRole('button', { name: '撤销' }),
    );
    expect(
      await screen.findByText('撤销失败：依赖这一处的内容已确认或已导入'),
    ).toBeTruthy();
    vi.mocked(ports.undo).mockResolvedValue({
      status: 'forbidden',
      message: 'x',
    });
    fireEvent.click(
      within(aside('已核对')).getByRole('button', { name: '撤销' }),
    );
    expect(await screen.findByText('撤销失败，刷新后再看')).toBeTruthy();
    vi.mocked(ports.undo).mockRejectedValue('offline');
    fireEvent.click(
      within(aside('已核对')).getByRole('button', { name: '撤销' }),
    );
    await waitFor(() =>
      expect(screen.getAllByText('撤销失败，刷新后再看')).toHaveLength(2),
    );
  });

  it('undoes an available result and asks the question again', async () => {
    const data = sampleData('hr');
    const ports = samplePorts(data);
    show(data, ports);
    choose('i-region', /整张只作附件/);
    await screen.findByText('这张图只作附件保存');
    fireEvent.click(
      within(aside('已核对')).getByRole('button', { name: '撤销' }),
    );
    await waitFor(() => expect(card('i-region')).toBeTruthy());
    expect(screen.getAllByText('已撤销，回到待核对').length).toBeGreaterThan(0);
  });
});
