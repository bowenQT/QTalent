// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import {
  sampleLookup,
  sampleReceipts,
  type SampleState,
} from '@/app/dev/design-system/receipt/samples';
import { Receipt } from './Receipt';
import { receiptView } from './receipt-view';

afterEach(cleanup);

const show = (state: SampleState) =>
  render(<Receipt view={receiptView(sampleReceipts[state], sampleLookup)} />);
const summary = () =>
  [...screen.getByRole('list', { name: '这次读到了什么' }).children].map(
    (item) => item.textContent,
  );

describe('receipt page', () => {
  it('while reading: no zero counts, a way to leave, and the hidden-content line', () => {
    const { container } = show('processing');
    expect(container.querySelector('.n-rstate')?.textContent).toBe('处理中');
    expect(summary()).toEqual([
      '3个文件2 个处理中',
      '人读完后统计',
      '件事读完后统计',
      '处待核对读完后统计',
      '0件待确认',
    ]);
    expect(
      screen.getByText('还在处理的文件读完后，这份回执会更新；可以先离开。'),
    ).toBeTruthy();
    expect(screen.getByText('整理出的事会出现在这里。')).toBeTruthy();
    expect(screen.getAllByText('部分内容已按权限隐藏')).toHaveLength(2);
    expect(
      container.querySelectorAll('.n-progress.is-indeterminate'),
    ).toHaveLength(2);
  });

  it('lists checks with their answers, and events one by one without actions', () => {
    const { container } = show('review');
    const checks = screen
      .getByRole('heading', { name: /待核对/ })
      .closest('article')!;
    expect(within(checks).getByText('1')).toBeTruthy();
    expect(
      [...checks.querySelectorAll('li')].map((row) => row.textContent),
    ).toEqual([
      '未知人员 「小周」指谁待接入',
      '说话人 「第二天就拿了两个方案过来」是谁说的 → 演示学员甲已核对',
      '未知人员 「阿泽」指谁 → 名单外的人已核对',
    ]);
    const cards = container.querySelectorAll('.n-rcpt');
    expect([...cards].map((card) => card.getAttribute('data-state'))).toEqual([
      'ai',
      'held',
      'held',
    ]);
    expect(cards[0].textContent).toContain('需求变更后当天给出两个备选方案');
    expect(cards[0].textContent).toContain('录音 03:12–03:28');
    expect(
      within(cards[0] as HTMLElement).getByRole('img', {
        name: /主动担当 4 分（AI 建议，未确认）/,
      }),
    ).toBeTruthy();
    expect(cards[0].textContent).toContain('资料不足');
    expect(cards[0].textContent).toContain('待接入');
    expect(cards[1].textContent).toContain('先决定合并还是分开');
    // Nothing that looks like it already works.
    expect(container.querySelector('button, a')).toBeNull();
    expect(screen.getByText('另有 1 件已确认。')).toBeTruthy();
    expect(screen.getByText('演示 · 一组')).toBeTruthy();
  });

  it('when done: real zeros, stopped files and every event already confirmed', () => {
    const { container } = show('done');
    expect(container.querySelector('.n-rstate')?.textContent).toBe('已完成');
    expect(summary()[0]).toBe('4个文件1 个处理中断1 个待换文件');
    expect(summary()[3]).toBe('0处待核对');
    expect(screen.getByText('这次整理出的 2 件事都已确认。')).toBeTruthy();
    expect(container.querySelectorAll('.n-file__state .err')).toHaveLength(2);
  });

  it('says why a batch failed, and that nothing was read when it was', () => {
    const base = sampleReceipts.done;
    render(
      <Receipt
        view={receiptView(
          {
            ...base,
            status: 'failed',
            files: [],
            resolvedItems: [],
            personIds: [],
            confirmedDrafts: [],
            counts: {
              ...base.counts,
              files: {
                ...base.counts.files,
                total: 0,
                parsed: 0,
                unsupported: 0,
                failed: 0,
              },
              events: { total: 0, awaiting_confirmation: 0, confirmed: 0 },
            },
            error: {
              code: 'processing_failed',
              message: '整理服务没有响应',
              retryable: true,
            },
          },
          sampleLookup,
        )}
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe(
      '这次投递没有整理完：整理服务没有响应',
    );
    expect(screen.getByText('这次交的是一段文字，没有上传文件。')).toBeTruthy();
    expect(
      screen.getByText('这次的材料里整理出 0 件事，原件已保存。'),
    ).toBeTruthy();
    expect(screen.getByText('这次的材料里没有确定涉及的人。')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /待核对/ })).toBeNull();
  });
});
