// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

const { page, replace, anchors, resolveNode } = vi.hoisted(() => ({
  resolveNode: vi.fn(),
  page: vi.fn(),
  replace: vi.fn(),
  anchors: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));
vi.mock('@/features/record/RecordPage', () => ({
  RecordPage: (props: Record<string, unknown>) => {
    page(props);
    return null;
  },
}));
vi.mock('@/server/actions/record-arrange', () => ({
  startRecordArrangeAction: vi.fn(),
}));
vi.mock('@/server/actions/record', () => ({
  saveRecordAction: vi.fn(),
  undoRecordAction: vi.fn(),
}));
vi.mock('@/server/actions/record-batch', () => ({
  readRecordAnchorsAction: anchors,
  readRecordBatchAction: vi.fn(),
  readRecordSourceAction: vi.fn(),
  resolveRecordNodeAction: resolveNode,
  saveRecordBatchAction: vi.fn(),
}));
import { LiveRecord, loadAnchors } from './LiveRecord';

const levels = (
  version: string,
  dimensionId: string,
  values = [1, 2, 3, 4, 5],
) =>
  values.map((value) => ({
    dimensionId,
    ruleVersion: version,
    value,
    text: `${dimensionId}-${value}`,
  }));

beforeEach(() => {
  page.mockReset();
  replace.mockReset();
  anchors.mockReset();
});
afterEach(cleanup);

describe('loadAnchors', () => {
  it('gives each person the five levels of each dimension in the asked version', async () => {
    anchors.mockResolvedValue([
      ...levels('v1', 'mot').reverse(),
      // A version with gaps shows no anchors rather than blank levels.
      ...levels('v1', 'prof', [1, 2, 4]),
    ]);
    const map = await loadAnchors({
      personIds: ['p1', 'p2'],
      ruleVersions: ['v1'],
    });
    expect(anchors).toHaveBeenCalledWith({ ruleVersions: ['v1'] });
    const set = {
      ruleVersion: 'v1',
      family: null,
      levels: ['mot-1', 'mot-2', 'mot-3', 'mot-4', 'mot-5'],
    };
    expect(map).toEqual({ p1: { mot: set }, p2: { mot: set } });
  });

  it('ignores rows of other versions', async () => {
    anchors.mockResolvedValue(levels('v2', 'mot'));
    expect(
      await loadAnchors({ personIds: ['p1'], ruleVersions: ['v1'] }),
    ).toEqual({});
  });
});

describe('LiveRecord', () => {
  it('binds the server actions, including node derivation, and keeps only ?batch= in the URL', async () => {
    window.history.replaceState(null, '', '/record?draft=work&person=p1');
    render(
      <LiveRecord
        accountId="a"
        accountName="演示"
        roleLabel="HR"
        people={[]}
        projects={[]}
        dimensions={[]}
      />,
    );
    const props = page.mock.calls[0]?.[0] as {
      actions: Record<string, unknown>;
      onBatchChange: (id: string | null) => void;
    };
    for (const name of ['submit', 'readBatch', 'save', 'undo', 'loadSource'])
      expect(typeof props.actions[name]).toBe('function');
    // 节点由服务端推导（#327）；页面只转交所选人员与项目。
    resolveNode.mockResolvedValue({ status: 'none' });
    const resolve = props.actions.resolveNode as (input: unknown) => unknown;
    expect(await resolve({ personIds: ['p1'], projectId: null })).toEqual({
      status: 'none',
    });
    expect(resolveNode).toHaveBeenCalledWith({
      personIds: ['p1'],
      projectId: null,
    });
    props.onBatchChange('b-1');
    expect(replace).toHaveBeenLastCalledWith('?person=p1&batch=b-1', {
      scroll: false,
    });
    window.history.replaceState(null, '', '/record?person=p1&batch=b-1');
    props.onBatchChange(null);
    expect(replace).toHaveBeenLastCalledWith('?person=p1', { scroll: false });
  });
});
