// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Check } from './Check';
import { Select } from './Select';
import { Textarea } from './Textarea';
afterEach(cleanup);
describe('Textarea and Select', () => {
  it('name the control by its label only and link the hint as its description', () => {
    render(
      <>
        <Textarea
          label="校准理由"
          note="必填"
          hint="原分和原评分人会一起保留"
          aria-describedby="extra"
        />
        <Select label="项目类型" hint="决定可选的状态">
          <option>业务项目</option>
        </Select>
      </>,
    );
    const textarea = screen.getByRole('textbox', { name: '校准理由 必填' });
    const description = textarea.getAttribute('aria-describedby') ?? '';
    expect(description.split(' ')).toContain('extra');
    const hintId = description.split(' ').find((id) => id !== 'extra') ?? '';
    expect(document.getElementById(hintId)?.textContent).toBe(
      '原分和原评分人会一起保留',
    );
    expect(textarea.getAttribute('aria-invalid')).toBeNull();
    expect(textarea.className).toBe('n-textarea');
    const select = screen.getByRole('combobox', { name: '项目类型' });
    expect(
      document.getElementById(select.getAttribute('aria-describedby') ?? '')
        ?.textContent,
    ).toBe('决定可选的状态');
    expect(select.className).toBe('n-select');
  });
  it('replaces the hint with an announced error and marks the field invalid', () => {
    render(
      <Textarea
        id="reason"
        label="校准理由"
        hint="这句不该出现"
        error="请先写下校准理由"
        className="extra"
      />,
    );
    const textarea = screen.getByRole('textbox', { name: '校准理由' });
    expect(textarea.id).toBe('reason');
    expect(textarea.className).toBe('n-textarea extra');
    expect(textarea.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe('请先写下校准理由');
    expect(screen.queryByText('这句不该出现')).toBeNull();
    expect(textarea.getAttribute('aria-describedby')).toBe(
      screen.getByRole('alert').id,
    );
    expect(textarea.closest('.n-field')?.classList.contains('is-error')).toBe(
      true,
    );
  });
  it('shows a select error and keeps native option choice', async () => {
    const user = userEvent.setup();
    render(
      <Select label="项目类型" error="请选择类型" defaultValue="a">
        <option value="a">业务项目</option>
        <option value="b">专项</option>
      </Select>,
    );
    const select = screen.getByRole('combobox', { name: '项目类型' });
    expect(select.getAttribute('aria-invalid')).toBe('true');
    await user.selectOptions(select, 'b');
    expect((select as HTMLSelectElement).value).toBe('b');
  });
});
describe('Check', () => {
  it('toggles from the label text and keeps native disabled behaviour', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Check defaultChecked>保存后通知项目 owner</Check>
        <Check disabled>不能改</Check>
      </>,
    );
    const box = screen.getByRole('checkbox', { name: '保存后通知项目 owner' });
    expect((box as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByText('保存后通知项目 owner'));
    expect((box as HTMLInputElement).checked).toBe(false);
    await user.click(screen.getByText('不能改'));
    expect(
      (screen.getByRole('checkbox', { name: '不能改' }) as HTMLInputElement)
        .checked,
    ).toBe(false);
  });
});
