import { describe, expect, it } from 'vitest';
import {
  talentSources,
  sourcesForDraft,
  type SourceProjectionData,
} from './talent-source-projection';

function data(): SourceProjectionData {
  return {
    fragments: [{
      id: 'fragment', originalVersionId: 'version', excerpt: 'Synthetic observation',
      location: { kind: 'document', paragraph: 'P1' },
    }],
    eventSources: [{ eventId: 'event-a', fragmentId: 'fragment', originalVersionId: 'version' }],
    events: [{ id: 'event-a', personId: 'student-a', projectId: 'project' }],
    participants: [{ eventId: 'event-a', personId: 'student-b' }],
    historical: [], historicalParticipants: [], statements: [],
    staffing: { projects: [{ id: 'project', cohortId: 'cohort' }] },
  };
}
const draft = [{
  fragmentId: 'fragment', originalVersionId: 'version',
  subjects: [{ personId: 'student-c', cohortId: 'cohort' }],
}];

describe('shared source projection extraction', () => {
  it('retains every original subject and sensitivity before adding draft subjects', () => {
    const source = data();
    source.statements = [{ fragmentId: 'fragment', originalVersionId: 'version', kind: 'management_observation' }];
    const [before] = talentSources(source);
    expect(before.subjects).toEqual([
      { personId: 'student-a', cohortId: 'cohort' },
      { personId: 'student-b', cohortId: 'cohort' },
    ]);
    const [after] = sourcesForDraft(source, draft);
    expect(after.subjects).toEqual([...before.subjects, ...draft[0].subjects]);
    expect(after.requiredKinds).toEqual(['management-observation']);
    expect(after.excerpt).toBe(before.excerpt);
    expect(after.location).toEqual(before.location);
  });
  it('fills an unlinked trusted draft source without reclassifying an existing forbidden source', () => {
    const source = data();
    source.eventSources = [];
    source.events = [];
    source.participants = [];
    expect(sourcesForDraft(source, draft)[0].subjects).toEqual(draft[0].subjects);
    source.eventSources = [{ eventId: 'missing', fragmentId: 'fragment', originalVersionId: 'version' }];
    expect(sourcesForDraft(source, draft)[0].subjects).toEqual([]);
  });
  it('does not let trusted draft subjects repair unclassified historical evidence', () => {
    const source = data();
    source.historical = [{
      id: 'history', personId: 'student-a', fragmentId: 'fragment',
      originalVersionId: 'version', sourceCategory: 'original', kind: '绩效',
    }];
    expect(talentSources(source)[0].subjects).toEqual([]);
    expect(sourcesForDraft(source, draft)[0].subjects).toEqual([]);
  });
  it('retains historical participant subjects and does not add unrelated fragments', () => {
    const source = data();
    source.historical = [{
      id: 'history', personId: null, fragmentId: 'fragment',
      originalVersionId: 'version', sourceCategory: 'prototype_baseline', kind: '训练营周评',
    }];
    source.historicalParticipants = [{ evaluationId: 'history', personId: 'student-d' }];
    const before = talentSources(source);
    expect(before[0].subjects).toContainEqual({ personId: 'student-d', cohortId: null });
    expect(sourcesForDraft(source, [{ ...draft[0], fragmentId: 'other' }])).toEqual(before);
  });
});
