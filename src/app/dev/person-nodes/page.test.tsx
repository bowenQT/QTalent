// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { personSchema } from '@/contracts/person';
import { sourceReadResultSchema } from '@/contracts/sources';
import { readyNodeRecords } from '@/features/person/node-records';
import { SamplePersonNodes } from './SamplePersonNodes';
import {
  loadSampleSource,
  SAMPLE_NODE_RECORDS,
  SAMPLE_PEOPLE,
  sampleNodeRecords,
} from './samples';

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  usePathname: () => '/dev/person-nodes',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.stubGlobal('matchMedia', () => ({
  matches: false,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('person node samples', () => {
  it('keeps every sample person inside the profile contract', () => {
    for (const person of Object.values(SAMPLE_PEOPLE))
      expect(personSchema.safeParse(person).success).toBe(true);
  });

  it('answers every cited source and refuses unknown ones', async () => {
    const records = readyNodeRecords(SAMPLE_NODE_RECORDS);
    expect(records).toHaveLength(3);
    for (const record of records)
      for (const source of record.sources) {
        const result = sourceReadResultSchema.parse(
          await loadSampleSource(source),
        );
        expect(result.status).toBe('success');
      }
    expect(
      (
        await loadSampleSource({
          fragmentId: 'missing',
          originalVersionId: 'missing',
        })
      ).status,
    ).toBe('not_found');
  });

  it('switches every kind to pending with records=pending', () => {
    expect(
      Object.values(sampleNodeRecords('pending')).map((block) => block.status),
    ).toEqual(['not_connected', 'not_connected', 'not_connected']);
    expect(sampleNodeRecords(undefined)).toBe(SAMPLE_NODE_RECORDS);
  });

  it('renders the three kinds for HR and none for the mentor', () => {
    const { container, unmount } = render(
      <SamplePersonNodes role="hr" records={undefined} />,
    );
    expect(container.querySelector('#ev-dev-interview-001')).toBeTruthy();
    expect(container.querySelector('#ev-dev-conclusion-001')).toBeTruthy();
    expect(container.querySelector('#ev-dev-observation-001')).toBeTruthy();
    unmount();
    const mentor = render(
      <SamplePersonNodes role="mentor" records={undefined} />,
    );
    expect(mentor.container.textContent).not.toMatch(/节点结论|北森/);
  });

  it('is not served by a production build', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { default: Page } = await import('./page');
    await expect(
      Page({ searchParams: Promise.resolve({ role: 'hr' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('renders the sample inside the desk shell for a known role', async () => {
    const { default: Page } = await import('./page');
    render(
      await Page({
        searchParams: Promise.resolve({ role: ['manager'], records: 'x' }),
      }),
    );
    expect(document.querySelector('#ev-dev-conclusion-001')).toBeTruthy();
    expect(document.body.textContent).toContain('程远演示');
  });

  it('refuses an unknown role', async () => {
    const { default: Page } = await import('./page');
    await expect(
      Page({ searchParams: Promise.resolve({ role: 'admin' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
