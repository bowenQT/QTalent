// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InputQuotes, SourceMarks } from './CitationMarks';
import { copy } from './copy';
import { OrganizeHeader } from './OrganizeHeader';
import { BannerNotice, FailurePanel } from './RecordNotices';
import { RecordInput } from './RecordInput';
import { people, receipt } from './record.fixtures';
import { SavedSign } from './SavedSign';

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('OrganizeHeader', () => {
  it('人、项目、演示徽标，多人时写同时记给谁', () => {
    render(
      <OrganizeHeader
        personIds={['p1', 'p2', 'unknown']}
        people={people}
        project={{ id: 'proj', name: '演示项目', kind: 'project' }}
        origin="text"
        demo
        niu="confirm"
      />,
    );
    expect(screen.getByText('演示甲')).toBeTruthy();
    expect(
      screen.getByText(copy.header.project('project', '演示项目')),
    ).toBeTruthy();
    expect(screen.getByText(copy.header.demo)).toBeTruthy();
    expect(
      screen.getByText(
        copy.header.alsoFor(
          `演示乙${copy.saved.peopleJoin}${copy.header.unknownPerson}`,
        ),
      ),
    ).toBeTruthy();
    expect(screen.getByRole('img', { name: '小犇：需要你确认' })).toBeTruthy();
  });

  it('识别前只写整理中；课题与来源徽标', () => {
    const { rerender } = render(
      <OrganizeHeader
        personIds={[]}
        people={people}
        project={null}
        origin="recording"
        demo={false}
        niu="thinking"
      />,
    );
    expect(screen.getByText(copy.live.organizing)).toBeTruthy();
    expect(screen.getByText(copy.header.fromRecording)).toBeTruthy();
    expect(screen.queryByText(copy.header.demo)).toBeNull();
    rerender(
      <OrganizeHeader
        personIds={['ghost']}
        people={people}
        project={{ id: 't', name: '演示课题', kind: 'topic' }}
        origin="attachment"
        demo={false}
        niu="done"
      />,
    );
    expect(screen.getByText(copy.header.fromAttachment)).toBeTruthy();
    expect(
      screen.getByText(copy.header.project('topic', '演示课题')),
    ).toBeTruthy();
    expect(screen.getByText(copy.header.unknownPerson)).toBeTruthy();
  });
});

describe('SavedSign', () => {
  it('署名、角色、刚刚保存到谁的档案，以及去档案看看（多人每人一条）', () => {
    render(
      <SavedSign
        receipt={{
          ...receipt,
          events: [
            { personId: 'p1', eventId: 'ev-1' },
            { personId: 'p2', eventId: 'ev-2' },
          ],
        }}
        people={people}
        accountName="演示导师"
        roleLabel="导师"
      />,
    );
    expect(screen.getAllByText('演示导师')).toHaveLength(2);
    expect(screen.getByText(/刚刚保存到演示甲的档案/)).toBeTruthy();
    expect(screen.getByText(/刚刚保存到演示乙的档案/)).toBeTruthy();
    const links = screen.getAllByRole('link', { name: copy.saved.link });
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/person?id=p1#ev-ev-1',
      '/person?id=p2#ev-ev-2',
    ]);
  });
});

describe('RecordInput', () => {
  function setup(over: Partial<Parameters<typeof RecordInput>[0]> = {}) {
    const handlers = {
      onText: vi.fn(),
      onPerson: vi.fn(),
      onSubmit: vi.fn(),
    };
    render(
      <RecordInput
        people={people}
        personId={null}
        text="一句原话"
        maxLength={10}
        submitting={false}
        showExample={false}
        {...handlers}
        {...over}
      />,
    );
    return handlers;
  }

  it('选项为「从原话里识别」加上有权限的人；选择回报 id 或空', async () => {
    const { onPerson } = setup();
    const select = screen.getByRole('combobox', { name: copy.input.whoLabel });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      copy.input.autoPerson,
      '演示甲 · 演示一组',
      '演示乙 · 演示二组',
    ]);
    await userEvent.selectOptions(select, 'p2');
    expect(onPerson).toHaveBeenLastCalledWith('p2');
    await userEvent.selectOptions(select, '');
    expect(onPerson).toHaveBeenLastCalledWith(null);
  });

  it('没有可记录的人时只留「从原话里识别」', () => {
    setup({ people: [] });
    expect(screen.getAllByRole('option')).toHaveLength(1);
  });

  it('占位：非生产环境带化名示例，生产用中性占位', () => {
    const view = setup({ showExample: true });
    expect(
      (screen.getByRole('textbox') as HTMLTextAreaElement).placeholder,
    ).toBe(copy.input.placeholderExample);
    void view;
  });

  it('中性占位和默认提示', () => {
    setup();
    expect(
      (screen.getByRole('textbox') as HTMLTextAreaElement).placeholder,
    ).toBe(copy.input.placeholderPlain);
    expect(screen.getByText(copy.input.hint)).toBeTruthy();
  });

  it('按钮提交；Ctrl/⌘+Enter 提交，普通 Enter 换行', () => {
    const { onSubmit } = setup();
    fireEvent.click(screen.getByRole('button', { name: copy.input.submit }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const box = screen.getByRole('textbox');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(3);
  });

  it('提交中：只读、按钮锁定，快捷键不再提交', () => {
    const { onSubmit } = setup({ submitting: true });
    const box = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(box.readOnly).toBe(true);
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      (
        screen.getByRole('button', {
          name: copy.input.submitting,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it('超出长度上限：提示缩短并锁定提交，输入不丢', () => {
    const { onSubmit } = setup({
      text: '这是一段超过十个字的原话内容',
      maxLength: 10,
    });
    expect(screen.getByText(copy.input.tooLong(10))).toBeTruthy();
    expect(
      (
        screen.getByRole('button', {
          name: copy.input.submit,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      '这是一段超过十个字的原话内容',
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('识别不到人的提醒放在提示句位置，附件入口留出位置', () => {
    setup({
      hint: <span>请选一下</span>,
      attachmentSlot: <button type="button">附件入口</button>,
    });
    expect(screen.getByText('请选一下')).toBeTruthy();
    expect(screen.getByRole('button', { name: '附件入口' })).toBeTruthy();
  });
});

describe('BannerNotice 与 FailurePanel', () => {
  const handlers = () => ({
    onRetry: vi.fn(),
    onLoadLatest: vi.fn(),
    onCopyOut: vi.fn(),
    onBack: vi.fn(),
  });

  it('没有提示时什么都不渲染；识别提示不在这里显示', () => {
    const { container, rerender } = render(
      <BannerNotice banner={null} {...handlers()} />,
    );
    expect(container.textContent).toBe('');
    rerender(<BannerNotice banner={{ kind: 'who' }} {...handlers()} />);
    expect(container.textContent).toBe('');
  });

  it('断网：说明内容还在，并可重试（提交与保存各一句）', async () => {
    const h = handlers();
    const { rerender } = render(
      <BannerNotice banner={{ kind: 'offline', scope: 'start' }} {...h} />,
    );
    expect(screen.getByText(copy.offline.start)).toBeTruthy();
    await userEvent.click(
      screen.getByRole('button', { name: copy.banner.sendRetry }),
    );
    expect(h.onRetry).toHaveBeenCalled();
    rerender(
      <BannerNotice banner={{ kind: 'offline', scope: 'save' }} {...h} />,
    );
    expect(screen.getByText(copy.offline.save)).toBeTruthy();
  });

  it('冲突：保留输入，可载入最新版本或先复制出来', async () => {
    const h = handlers();
    render(
      <BannerNotice
        banner={{ kind: 'conflict', message: '别处刚保存过' }}
        {...h}
      />,
    );
    expect(screen.getByText(copy.conflict.title)).toBeTruthy();
    expect(screen.getByText('别处刚保存过')).toBeTruthy();
    await userEvent.click(
      screen.getByRole('button', { name: copy.actions.loadLatest }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: copy.actions.copyOut }),
    );
    expect(h.onLoadLatest).toHaveBeenCalled();
    expect(h.onCopyOut).toHaveBeenCalled();
  });

  it('权限变化：保留原话，可改原话或复制', async () => {
    const h = handlers();
    render(
      <BannerNotice
        banner={{ kind: 'forbidden', message: '范围已调整' }}
        {...h}
      />,
    );
    expect(screen.getByText(copy.forbidden.title)).toBeTruthy();
    await userEvent.click(
      screen.getByRole('button', { name: copy.actions.back }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: copy.actions.copyInput }),
    );
    expect(h.onBack).toHaveBeenCalled();
    expect(h.onCopyOut).toHaveBeenCalled();
  });

  it('被拒绝和校验问题', () => {
    const { rerender } = render(
      <BannerNotice
        banner={{ kind: 'refused', message: '请稍后再试' }}
        {...handlers()}
      />,
    );
    expect(screen.getByText('请稍后再试')).toBeTruthy();
    rerender(
      <BannerNotice banner={{ kind: 'saveProblems' }} {...handlers()} />,
    );
    expect(screen.getByText(copy.banner.problems)).toBeTruthy();
  });

  it('失败面板：按失败类型给出口；命令失败的说明单独显示', async () => {
    const onReorganize = vi.fn();
    const onEdit = vi.fn();
    const { rerender } = render(
      <FailurePanel
        failure="processing_failed"
        canReorganize
        busy={false}
        commandMessage={copy.failure.commandFailed}
        onReorganize={onReorganize}
        onEdit={onEdit}
      />,
    );
    expect(screen.getByText(copy.failure.processing_failed)).toBeTruthy();
    expect(screen.getByText(copy.failure.commandFailed)).toBeTruthy();
    await userEvent.click(
      screen.getByRole('button', { name: copy.actions.reorganize }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: copy.actions.back }),
    );
    expect(onReorganize).toHaveBeenCalled();
    expect(onEdit).toHaveBeenCalled();

    // 原话已更新：只能重新整理
    rerender(
      <FailurePanel
        failure="input_changed"
        canReorganize
        busy
        onReorganize={onReorganize}
        onEdit={onEdit}
        commandMessage={null}
      />,
    );
    expect(
      screen.queryByRole('button', { name: copy.actions.back }),
    ).toBeNull();
    expect(
      (
        screen.getByRole('button', {
          name: copy.actions.reorganize,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    // 已取消：只能改原话
    rerender(
      <FailurePanel
        failure="cancelled"
        canReorganize
        busy={false}
        onReorganize={onReorganize}
        onEdit={onEdit}
        commandMessage={null}
      />,
    );
    expect(
      screen.queryByRole('button', { name: copy.actions.reorganize }),
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: copy.actions.back }),
    ).toBeTruthy();

    // 没有原话可重提（刷新后恢复）：只剩改原话
    rerender(
      <FailurePanel
        failure="processing_failed"
        canReorganize={false}
        busy={false}
        onReorganize={onReorganize}
        onEdit={onEdit}
        commandMessage={null}
      />,
    );
    expect(
      screen.queryByRole('button', { name: copy.actions.reorganize }),
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: copy.actions.back }),
    ).toBeTruthy();
  });
});

describe('InputQuotes / SourceMarks', () => {
  const citations = [
    { kind: 'input', quote: '独立完成', start: 5, end: 9 },
    {
      kind: 'source',
      quote: '来源里的一句话',
      reference: {
        fragmentId: 'frag-1',
        originalVersionId: 'ver-1',
        location: { kind: 'document', paragraph: '第 2 段' },
      },
    },
  ] as const;

  it('原话引用照原型行内写出，是普通文字', () => {
    const view = render(
      <span>
        锚点 3
        <InputQuotes citations={[...citations]} />
      </span>,
    );
    expect(view.container.textContent).toBe(
      `锚点 3${copy.cite.inline}「独立完成」`,
    );
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('来源引用用角标，从 1 编号，展开时才读取原文', async () => {
    const loadSource = vi.fn().mockResolvedValue({
      status: 'success',
      source: {
        fragmentId: 'frag-1',
        originalVersionId: 'ver-1',
        location: { kind: 'document', paragraph: '第 2 段' },
        excerpt: '来源里的一句话',
        originalTitle: '测试材料.docx',
        recordedByName: null,
        sourceType: 'document',
        sourceCategory: 'original',
        demo: true,
      },
    });
    render(<SourceMarks citations={[...citations]} loadSource={loadSource} />);
    expect(screen.queryByText(/独立完成/)).toBeNull();
    expect(loadSource).not.toHaveBeenCalled();
    await userEvent.hover(screen.getByRole('button', { name: /^引用 1/ }));
    expect(await screen.findByText('来源里的一句话')).toBeTruthy();
    expect(loadSource).toHaveBeenCalledWith({
      fragmentId: 'frag-1',
      originalVersionId: 'ver-1',
    });
  });
});
