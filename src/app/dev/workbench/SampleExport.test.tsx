// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import {
  useExportPort,
  type ExportPort,
} from '@/features/workbench/sections/export/export-port';
import { sampleViews } from './samples';
import { SampleExport } from './SampleExport';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const view = sampleViews.hr;
const scopes =
  view.exportable.status === 'ready' ? view.exportable.data.scopes : [];

function portOf(failFirst: boolean) {
  let port: ExportPort | null = null;
  function Probe() {
    port = useExportPort();
    return null;
  }
  render(
    <SampleExport scopes={scopes} failFirst={failFirst}>
      <Probe />
    </SampleExport>,
  );
  if (!port) throw new Error('no port');
  return port as ExportPort;
}
async function run(port: ExportPort, scope: string) {
  vi.useFakeTimers();
  const result = port.generate(scope, 'last12Months');
  await vi.advanceTimersByTimeAsync(200);
  return result;
}

describe('development export sample', () => {
  it('ends empty for a scope without confirmed content', async () => {
    expect(await run(portOf(false), 'follow')).toEqual({ status: 'empty' });
    expect(await run(portOf(false), 'missing')).toEqual({ status: 'empty' });
  });

  it('finishes with a demo table for the prototype numbers', async () => {
    const outcome = await run(portOf(false), 'all');
    expect(outcome).toMatchObject({
      status: 'done',
      people: 95,
      rows: 561,
      fileName: '已确认内容-我负责的人-20260904.csv',
    });
    expect(outcome.status === 'done' && outcome.href).toMatch(
      /^data:text\/csv;charset=utf-8,/,
    );
  });

  it('fails the first run only when asked to', async () => {
    const port = portOf(true);
    expect(await run(port, 'all')).toEqual({
      status: 'failed',
      reason: '导出服务超时',
    });
    expect((await run(port, 'all')).status).toBe('done');
  });
});
