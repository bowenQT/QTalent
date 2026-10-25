// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DropZone } from './DropZone';
import type { FileSelection, FileSelectionRules } from './file-selection';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const rules: FileSelectionRules = {
  extensions: ['mp3', 'docx', 'pdf'],
  acceptedLabel: 'MP3 / DOCX / PDF',
  maxBytes: 1000,
  maxFiles: 3,
};

function file(name: string, size = 10) {
  const created = new File(['x'], name);
  Object.defineProperty(created, 'size', { value: size });
  return created;
}

function setup(props: { currentCount?: number; disabled?: boolean } = {}) {
  const onSelect = vi.fn<(selection: FileSelection) => void>();
  const view = render(
    <DropZone
      rules={rules}
      currentCount={props.currentCount ?? 0}
      disabled={props.disabled}
      hint="可以一次拖入多个"
      onSelect={onSelect}
    />,
  );
  const button = screen.getByRole('button', { name: /拖入文件，或点这里选择/ });
  const input =
    view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
  return { onSelect, button, input };
}

const filesDrag = (files: File[] = []) => ({
  dataTransfer: { types: ['Files'], files, dropEffect: 'none' },
});

describe('DropZone', () => {
  it('opens the file picker from the keyboard with Enter and Space', async () => {
    const opened = vi.spyOn(HTMLInputElement.prototype, 'click');
    const user = userEvent.setup();
    const { button, input } = setup();
    await user.tab();
    expect(document.activeElement).toBe(button);
    await user.keyboard('{Enter}');
    expect(opened).toHaveBeenCalledTimes(1);
    await user.keyboard(' ');
    expect(opened).toHaveBeenCalledTimes(2);
    expect(opened.mock.contexts).toEqual([input, input]);
  });

  it('is a plain button whose picker accepts several files of the allowed types', () => {
    const { button, input } = setup();
    expect(button.getAttribute('type')).toBe('button');
    expect(button.contains(input)).toBe(false);
    expect(input.multiple).toBe(true);
    expect(input.accept).toBe('.mp3,.docx,.pdf');
  });

  it('hands picked files to the caller already checked, and resets the input', async () => {
    // 选择器的 accept 只是提示，用户可以切到「所有文件」，所以组件仍要自己校验。
    const user = userEvent.setup({ applyAccept: false });
    const { onSelect, input } = setup();
    await user.upload(input, [
      file('a.docx'),
      file('b.zip'),
      file('c.mp3', 2000),
    ]);
    expect(onSelect).toHaveBeenCalledTimes(1);
    const selection = onSelect.mock.calls[0][0];
    expect(selection.accepted.map((f) => f.name)).toEqual(['a.docx']);
    expect(selection.rejected.map((r) => [r.file.name, r.reason])).toEqual([
      ['b.zip', 'unsupported'],
      ['c.mp3', 'too_large'],
    ]);
    expect(input.value).toBe('');
  });

  it('does not call back when the picker is cancelled with nothing chosen', () => {
    const { onSelect, input } = setup();
    fireEvent.change(input);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('takes several dropped files at once and asks for the overflow to be picked again', () => {
    const { onSelect, button } = setup({ currentCount: 1 });
    fireEvent.drop(
      button,
      filesDrag([file('a.pdf'), file('b.pdf'), file('c.pdf')]),
    );
    const selection = onSelect.mock.calls[0][0];
    expect(selection.accepted.map((f) => f.name)).toEqual(['a.pdf', 'b.pdf']);
    expect(selection.overflow?.message).toBe(
      '已加入前 2 个附件，其余 1 个请再选一次',
    );
  });

  it('shows the drag-over look while files are over it, even when crossing inner elements', () => {
    const { button } = setup();
    const label = screen.getByText('拖入文件，或点这里选择');
    expect(button.className).not.toContain('is-over');
    fireEvent.dragEnter(button, filesDrag());
    expect(button.className).toContain('is-over');
    // 指针从按钮移到里面的文字：先进入子元素，再离开按钮本身。
    fireEvent.dragEnter(label, filesDrag());
    fireEvent.dragLeave(button, filesDrag());
    expect(button.className).toContain('is-over');
    fireEvent.dragLeave(label, filesDrag());
    expect(button.className).not.toContain('is-over');
  });

  it('allows the drop and clears the look afterwards', () => {
    const { button } = setup();
    expect(fireEvent.dragOver(button, filesDrag())).toBe(false);
    fireEvent.dragEnter(button, filesDrag());
    expect(fireEvent.drop(button, filesDrag([file('a.pdf')]))).toBe(false);
    expect(button.className).not.toContain('is-over');
  });

  it('ignores drags that do not carry files', () => {
    const { onSelect, button } = setup();
    const text = { dataTransfer: { types: ['text/plain'], files: [] } };
    fireEvent.dragEnter(button, text);
    expect(button.className).not.toContain('is-over');
    expect(fireEvent.drop(button, text)).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.drop(button, filesDrag([]));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('does nothing while disabled', async () => {
    const opened = vi.spyOn(HTMLInputElement.prototype, 'click');
    const user = userEvent.setup();
    const { onSelect, button } = setup({ disabled: true });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    await user.click(button);
    expect(opened).not.toHaveBeenCalled();
    // 仍要取消默认行为，否则浏览器会把拖入的文件当页面打开。
    expect(fireEvent.dragEnter(button, filesDrag())).toBe(false);
    const over = filesDrag();
    expect(fireEvent.dragOver(button, over)).toBe(false);
    expect(over.dataTransfer.dropEffect).toBe('none');
    expect(fireEvent.drop(button, filesDrag([file('a.pdf')]))).toBe(false);
    expect(button.className).not.toContain('is-over');
    expect(onSelect).not.toHaveBeenCalled();
  });
});
