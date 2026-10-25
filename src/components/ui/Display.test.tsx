// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Avatar } from './Avatar';
import { Badge, type BadgeTone } from './Badge';
import { Card } from './Card';
import { PersonRow } from './PersonRow';
import { Fail, Lock, State } from './State';
afterEach(cleanup);
describe('Badge', () => {
  it('maps each tone to the prototype class and adds the optional icon first', () => {
    const tones: BadgeTone[] = [
      'yes',
      'no',
      'unknown',
      'conflict',
      'ai',
      'demo',
      'preset',
      'archived',
      'ended',
      'prep',
      'recal',
      'seal',
    ];
    render(
      <>
        {tones.map((tone) => (
          <Badge key={tone} tone={tone} data-tone={tone}>
            {tone}
          </Badge>
        ))}
        <Badge tone="yes" icon="check" className="extra">
          支持
        </Badge>
        <Badge>待跟进</Badge>
      </>,
    );
    for (const tone of tones)
      expect(document.querySelector(`[data-tone="${tone}"]`)?.className).toBe(
        `n-badge n-badge--${tone}`,
      );
    const withIcon = screen.getByText('支持');
    expect(withIcon.className).toBe('n-badge n-badge--yes extra');
    expect(withIcon.firstElementChild?.tagName.toLowerCase()).toBe('svg');
    expect(screen.getByText('待跟进').className).toBe('n-badge');
  });
});
describe('Card', () => {
  it('is a plain container whose element can be chosen', () => {
    render(
      <Card as="article" aria-label="卡片" className="n-project">
        内容
      </Card>,
    );
    const card = screen.getByRole('article', { name: '卡片' });
    expect(card.className).toBe('n-card n-project');
    expect(card.textContent).toBe('内容');
  });
});
describe('PersonRow', () => {
  it('lays out avatar, linked name, marker, meta and the trailing slot', () => {
    render(
      <>
        <PersonRow
          avatar={<Avatar name="林知远" hue={200} />}
          name="林知远"
          href="/people/lin"
          nameAfter={<Badge tone="demo">演示</Badge>}
          meta="业务成功部 · 初级产品架构师"
          trailing={<Badge>高潜待练</Badge>}
        />
        <PersonRow avatar={<Avatar name="陈一禾" hue={150} />} name="陈一禾" />
      </>,
    );
    const link = screen.getByRole('link', { name: '林知远' });
    expect(link.getAttribute('href')).toBe('/people/lin');
    expect(link.className).toBe('nt-plink');
    const rows = document.querySelectorAll('.n-person-row');
    expect(rows[0].querySelector('.n-person__name')?.textContent).toBe(
      '林知远演示',
    );
    expect(rows[0].querySelector('.n-person__meta')?.textContent).toBe(
      '业务成功部 · 初级产品架构师',
    );
    expect(rows[0].lastElementChild?.textContent).toBe('高潜待练');
    expect(rows[1].querySelector('a')).toBeNull();
    expect(rows[1].querySelector('.n-person__meta')).toBeNull();
    expect(rows[1].children).toHaveLength(1);
  });
});
describe('State, Fail and Lock', () => {
  it('uses a different brand state and live role for loading, empty, failed and denied', () => {
    render(
      <>
        <State kind="loading" title="正在检索" card />
        <State
          kind="empty"
          title="关键事件会出现在这里"
          text="说一句最近做的事"
        >
          <button>记录第一条</button>
        </State>
        <State kind="failed" title="转写没有完成" />
        <State kind="denied" title="这部分资料在你的查看范围之外" />
        <State title="页面链接失效" />
      </>,
    );
    const states = [...document.querySelectorAll('.n-state')];
    expect(states.map((node) => node.className)).toEqual([
      'n-card n-state',
      'n-state',
      'n-state',
      'n-state',
      'n-state',
    ]);
    expect(
      states.map((node) =>
        node.querySelector('.ip')?.getAttribute('data-state'),
      ),
    ).toEqual(['searching', 'listening', 'error', undefined, 'confirm']);
    expect(states.map((node) => node.getAttribute('role'))).toEqual([
      'status',
      null,
      'alert',
      null,
      null,
    ]);
    expect(states[3].querySelector('.n-avatar--lg svg')).toBeTruthy();
    expect(screen.getByRole('button', { name: '记录第一条' })).toBeTruthy();
  });
  it('keeps what was retained and the next steps visible in a failure', () => {
    render(
      <>
        <Fail
          title="整理超时"
          kept="已保存的原话：「W2 中途客户说搜索结果看不懂」"
          actions={<button>再整理一次</button>}
        >
          你的原话已保存，待整理成事件。
        </Fail>
        <Fail title="Jev 的判断暂未生成" icon="clock" />
        <Lock>仅本人资料</Lock>
      </>,
    );
    const fails = document.querySelectorAll('.n-fail');
    expect(fails[0].querySelector('.n-fail__head')?.textContent).toBe(
      '整理超时',
    );
    expect(fails[0].querySelector('.n-fail__kept')?.textContent).toContain(
      '已保存的原话',
    );
    expect(screen.getByRole('button', { name: '再整理一次' })).toBeTruthy();
    expect(fails[1].querySelector('p, .n-fail__kept, button')).toBeNull();
    expect(document.querySelector('.n-lock')?.textContent).toBe('仅本人资料');
  });
});
