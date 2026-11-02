// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const shown = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('@/features/shell/Shell', () => ({
  Shell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/features/person-print/PersonPrint', () => ({
  PersonPrint: (props: unknown) => {
    shown(props);
    return <p>person-print</p>;
  },
}));

import PersonPrintSample from './page';
import { samplePorts, sampleShell } from './samples';

const open = (params: Record<string, string>) =>
  PersonPrintSample({ searchParams: Promise.resolve(params) });

afterEach(() => {
  cleanup();
  shown.mockReset();
  vi.unstubAllEnvs();
});

describe('profile print sample', () => {
  it('shows the entry to managers and HR, and the line only to mentors', async () => {
    for (const [role, canPrint] of [
      ['manager', true],
      ['hr', true],
      ['mentor', false],
    ] as const) {
      render(await open({ role }));
      expect(screen.getByRole('heading', { name: '孟映雪 演示' })).toBeTruthy();
      expect(shown).toHaveBeenLastCalledWith(
        expect.objectContaining({
          personId: 'p-x07',
          personName: '孟映雪',
          canPrint,
        }),
      );
      cleanup();
    }
    render(await open({ role: 'manager', person: 'x03', print: 'live' }));
    expect(shown).toHaveBeenLastCalledWith(
      expect.objectContaining({ personId: 'p-x03', personName: '谢怀瑾' }),
    );
    expect(sampleShell('mentor').account.name).toBe('叶青');
  });

  it('answers 404 for unknown parameters and in production', async () => {
    for (const params of [
      {},
      { role: 'admin' },
      { role: 'hr', person: 'x99' },
      { role: 'hr', print: 'later' },
    ] as Record<string, string>[])
      await expect(open(params)).rejects.toThrow('NEXT_NOT_FOUND');
    vi.stubEnv('NODE_ENV', 'production');
    await expect(open({ role: 'hr' })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('prints, refuses or loses the first print in memory', async () => {
    const ok = samplePorts('x03', 'manager', 'ok');
    expect(await ok.preview('p-x03')).toMatchObject({
      status: 'ready',
      preview: { eventCount: 3, scoreCount: 6 },
    });
    const printed = await ok.print({ operationId: 'o', personId: 'p-x03' });
    if (printed.status !== 'printed') throw new Error('printed');
    expect(printed.sheet.printedByName).toBe('程远');
    expect(printed.sheet.events.flatMap((e) => e.scores)).toHaveLength(6);
    expect(await samplePorts('x07', 'hr', 'deny').preview('p-x07')).toEqual({
      status: 'denied',
    });
    const fail = samplePorts('x07', 'hr', 'fail');
    await expect(
      fail.print({ operationId: 'o', personId: 'p-x07' }),
    ).rejects.toThrow();
    expect(
      (await fail.print({ operationId: 'o', personId: 'p-x07' })).status,
    ).toBe('printed');
  });
});
