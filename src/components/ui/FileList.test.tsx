// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileList, type FileListEntry } from './FileList';
import { Progress } from './Progress';

afterEach(cleanup);

const uploading: FileListEntry = {
  id: 'f1',
  ext: 'M4A',
  name: '导师访谈.m4a',
  status: 'uploading',
  progress: 20,
  message: '上传中 · 182 MB',
};

describe('FileList', () => {
  it('renders nothing for an empty list and the compact variant for attachments', () => {
    const view = render(<FileList entries={[]} />);
    expect(view.container.innerHTML).toBe('');
    view.rerender(<FileList entries={[uploading]} variant="attach" />);
    expect(screen.getByRole('list').className).toBe('n-files n-attach');
    view.rerender(<FileList entries={[uploading]} />);
    expect(screen.getByRole('list').className).toBe('n-files');
  });

  it('removes a row through its own labelled button', async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(
      <FileList
        entries={[uploading, { ...uploading, id: 'f2', name: '另一个.m4a' }]}
        onRemove={onRemove}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: '移除附件「另一个.m4a」' }),
    );
    expect(onRemove).toHaveBeenCalledExactlyOnceWith('f2');
  });

  it('shows no remove button once the list is read-only, but keeps row actions', () => {
    render(
      <FileList
        readOnly
        onRemove={vi.fn()}
        entries={[
          { ...uploading, status: 'parsed', message: '可定位到页' },
          {
            ...uploading,
            id: 'f2',
            status: 'parsed',
            message: '可定位到段',
            action: <button type="button">查看</button>,
          },
        ]}
      />,
    );
    expect(screen.queryByRole('button', { name: /移除附件/ })).toBeNull();
    expect(screen.getByRole('button', { name: '查看' })).toBeTruthy();
  });

  it('shows no remove button when the caller gives no handler', () => {
    render(<FileList entries={[uploading]} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keeps focus on the same remove button while progress and status refresh', () => {
    const view = render(<FileList entries={[uploading]} onRemove={vi.fn()} />);
    const remove = screen.getByRole('button', { name: /移除附件/ });
    const row = remove.closest('li');
    remove.focus();
    for (const progress of [40, 80, 100]) {
      view.rerender(
        <FileList entries={[{ ...uploading, progress }]} onRemove={vi.fn()} />,
      );
      expect(
        screen.getByRole('progressbar').getAttribute('aria-valuenow'),
      ).toBe(String(progress));
      expect(document.activeElement).toBe(remove);
    }
    view.rerender(
      <FileList
        entries={[{ ...uploading, status: 'processing', message: '转写中…' }]}
        onRemove={vi.fn()}
      />,
    );
    view.rerender(
      <FileList
        entries={[
          {
            ...uploading,
            status: 'parsed',
            headline: '已解析',
            message: 'M4A · 可定位到时间点',
          },
        ]}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /移除附件/ })).toBe(remove);
    expect(remove.closest('li')).toBe(row);
    expect(document.activeElement).toBe(remove);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('keeps other rows untouched when one row is removed', () => {
    const view = render(
      <FileList
        entries={[uploading, { ...uploading, id: 'f2', name: '另一个.m4a' }]}
        onRemove={vi.fn()}
      />,
    );
    const second = screen.getByText('另一个.m4a').closest('li');
    view.rerender(
      <FileList
        entries={[{ ...uploading, id: 'f2', name: '另一个.m4a' }]}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText('另一个.m4a').closest('li')).toBe(second);
  });
});

describe('FileItem status text', () => {
  it('writes the located result in green after a headline, and failures in red', () => {
    render(
      <FileList
        entries={[
          {
            ...uploading,
            id: 'a',
            status: 'parsed',
            headline: '已解析',
            message: '12 段，定位到段落',
          },
          {
            ...uploading,
            id: 'b',
            status: 'failed',
            headline: '读不出内容',
            message: '文件设置了打开密码',
          },
          {
            ...uploading,
            id: 'c',
            status: 'unsupported',
            message: '暂不支持 .zip 格式，可以上传 PDF',
          },
        ]}
      />,
    );
    const states = [...document.querySelectorAll('.n-file__state')];
    expect(states.map((s) => s.textContent)).toEqual([
      '已解析 · 12 段，定位到段落',
      '读不出内容 · 文件设置了打开密码',
      '暂不支持 .zip 格式，可以上传 PDF',
    ]);
    expect(states[0].querySelector('.ok')?.textContent).toBe('已解析');
    expect(states[1].querySelector('.err')?.textContent).toBe('读不出内容');
    expect(states[2].querySelector('.err')?.textContent).toBe(
      '暂不支持 .zip 格式，可以上传 PDF',
    );
  });

  it('shows byte progress while uploading and an unknown-length bar while processing', () => {
    const view = render(<FileList entries={[uploading]} />);
    const bar = screen.getByRole('progressbar', {
      name: '导师访谈.m4a 上传进度',
    });
    expect(bar.getAttribute('aria-valuenow')).toBe('20');
    expect(bar.querySelector('i')?.style.width).toBe('20%');
    view.rerender(
      <FileList
        entries={[{ ...uploading, status: 'processing', message: '转写中…' }]}
      />,
    );
    const busy = screen.getByRole('progressbar', {
      name: '导师访谈.m4a 处理进度',
    });
    expect(busy.className).toContain('is-indeterminate');
    expect(busy.getAttribute('aria-valuetext')).toBe('处理中');
    expect(busy.hasAttribute('aria-valuenow')).toBe(false);
  });

  it('starts an upload at zero when no progress is known yet', () => {
    render(<FileList entries={[{ ...uploading, progress: undefined }]} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(
      '0',
    );
  });
});

describe('Progress', () => {
  it('keeps the value within 0–100', () => {
    const view = render(<Progress value={150} label="a" />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(
      '100',
    );
    view.rerender(<Progress value={-5} label="a" />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(
      '0',
    );
  });
});
