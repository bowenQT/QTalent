// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MediaDesignSystem from './page';

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not-found');
  },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('media design-system sample route', () => {
  it('renders the upload and long-task samples outside production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    render(<MediaDesignSystem />);
    expect(screen.getByRole('heading', { name: '上传材料' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '进行中的任务' })).toBeTruthy();
    expect(
      document.querySelectorAll('[data-sample="tasks"] .n-task'),
    ).toHaveLength(7);
  });

  it('lets a reviewer try dropping files and removing rows', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    render(<MediaDesignSystem />);
    const small = new File(['x'], '纪要.docx');
    const zip = new File(['x'], '方案.zip');
    fireEvent.drop(screen.getByRole('button', { name: /拖入文件/ }), {
      dataTransfer: { types: ['Files'], files: [small, zip] },
    });
    const result = screen.getByRole('status', { name: '选择结果' });
    expect(result.textContent).toContain('「方案.zip」暂不支持 .zip 格式');
    expect(result.textContent).toContain('「纪要.docx」可以加入（1 KB）');
    await userEvent.click(
      screen.getByRole('button', { name: '移除附件「导师访谈.m4a」' }),
    );
    expect(
      screen.queryByRole('button', { name: '移除附件「导师访谈.m4a」' }),
    ).toBeNull();
  });

  it('is a 404 in production builds, independent of the parent page gate', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(MediaDesignSystem).toThrow('not-found');
  });
});
