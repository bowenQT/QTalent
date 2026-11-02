// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import {
  samplePreview,
  sampleStandard,
} from '@/app/dev/standard-iteration/samples';
import {
  ChangeTable,
  Diff,
  EffectText,
  ImpactPreview,
  RevisionStateTag,
} from './parts';
import { changeCount, diffParts } from './revision-view';

afterEach(cleanup);
const [work, process] = sampleStandard.reviewPoints;
const preview = samplePreview(1, '2026-09-04T02:00:00Z');

describe('revision parts', () => {
  it('marks only the changed middle of a point', () => {
    expect(diffParts('评 A / B', '评 A / B / C')).toEqual({
      head: '评 A / B',
      removed: '',
      added: ' / C',
      tail: '',
    });
    const view = render(<Diff from="看演示和路演" to="看演示" />);
    expect(view.container.querySelector('del')?.textContent).toBe('和路演');
    expect(view.container.querySelector('ins')).toBeNull();
  });

  it('lists added, removed and edited points', () => {
    render(
      <ChangeTable
        changes={[
          { kind: 'remove', before: work },
          {
            kind: 'edit',
            before: process,
            after: { ...process, title: '开发质量' },
          },
        ]}
      />,
    );
    expect(screen.getByText('删除要点')).toBeTruthy();
    expect(screen.getByText('修改要点')).toBeTruthy();
    expect(changeCount([])).toBe('在原处直接改，改过的地方会标出原值');
  });

  it('names the lifecycle state, with or without a version', () => {
    render(
      <>
        <RevisionStateTag state="active" versionId="xe-select-v2" />
        <RevisionStateTag state="superseded" />
      </>,
    );
    expect(screen.getByText('生效中 xe-select-v2').getAttribute('data-s')).toBe(
      'live',
    );
    expect(screen.getByText('已替代').getAttribute('data-s')).toBe('old');
  });

  it('describes the effect point without kept cohorts or basis', () => {
    const empty = { ...preview, preservedBindings: [] };
    const view = render(<EffectText preview={empty} baseVersionId="v0" />);
    expect(view.container.textContent).not.toContain('保持 v0）');
    cleanup();
    const impact = render(<ImpactPreview preview={empty} basisLines={[]} />);
    expect(impact.container.querySelector('.n-impact__basis')).toBeNull();
    expect(screen.getByText('0 期')).toBeTruthy();
  });
});
