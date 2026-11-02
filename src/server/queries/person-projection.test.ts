import { describe, expect, it } from 'vitest';
import { personSchema } from '../../contracts/person';
import { fixture } from './person-test-helpers';
import { personFromData } from './person-projection';
import { peopleFromData, quickViewFromData } from './people';
import { sourceFromData } from './sources';
import type { PersonData } from './person-data';

// ---------- helpers ----------
type Confirmation = PersonData['confirmations'][number];
const addAnchor = (data: PersonData, dimensionId: string, value: number) => {
  const id = `${dimensionId}-${value}`;
  if (!data.anchors.some((row) => row.id === id))
    data.anchors.push({
      id,
      dimensionId,
      ruleVersionId: 'rubric-v1',
      value,
      text: `Anchor ${value}`,
    });
  return id;
};
const addScore = (
  data: PersonData,
  over: Partial<Confirmation> & { id: string; eventId: string },
  dimensionId = 'prof',
) => {
  const value = over.value === undefined ? 4 : over.value;
  data.confirmations.push({
    ...data.confirmations[0],
    dimensionId,
    evaluatorId: 'two',
    status: 'scored',
    value,
    anchorId: value === null ? null : addAnchor(data, dimensionId, value),
    fragmentId: 'fragment-' + over.eventId.slice(-1),
    ...over,
  });
};
const daysBefore = (days: number) =>
  new Date(Date.parse('2026-07-01') - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
const profileOf = async (data: PersonData, id = 'one') => {
  const person = await personFromData(data, id);
  if (!person) throw new Error('missing profile');
  return person;
};
const cards = (person: Awaited<ReturnType<typeof profileOf>>) => {
  if (person.timeline.status !== 'ready') throw new Error('no timeline');
  return person.timeline.data.flatMap((row) =>
    row.kind === 'key_event' ? [row] : [],
  );
};
const spectrum = (person: Awaited<ReturnType<typeof profileOf>>) => {
  if (person.capabilityProfile.status !== 'ready')
    throw new Error('no spectrum');
  return person.capabilityProfile.data;
};

describe('identity and landing', () => {
  it('projects avatar, team, batch and tenure from the directory', async () => {
    const person = await profileOf(fixture());
    expect(person.person).toEqual({
      id: 'one',
      name: 'Synthetic one',
      hue: 220,
      photo: null,
      demo: true,
      teamId: 'org',
      teamName: 'Test',
      teamPath: 'Synthetic org',
      jobTitle: '职位未接入',
      level: null,
      batch: { id: 'cohort', name: 'Synthetic cohort' },
      tenureLabel: '入营 6 个月',
    });
    expect(person.asOf).toBe('2026-07-01');
  });
  it('words the tenure like the prototype at the 59/60 and 364/365 day edges', async () => {
    const wording = async (days: number) => {
      const data = fixture();
      data.context.enrollments[0].validFrom = daysBefore(days);
      return (await profileOf(data)).person.tenureLabel;
    };
    expect(await wording(0)).toBe('入营 1 周');
    expect(await wording(59)).toBe('入营 8 周');
    expect(await wording(60)).toBe('入营 2 个月');
    expect(await wording(364)).toBe('入营 12 个月');
    expect(await wording(365)).toBe('入营 1 年');
  });
  it('falls back to the earliest hire date, and to null instead of 0', async () => {
    const data = fixture();
    data.context.enrollments = [];
    expect((await profileOf(data)).person).toMatchObject({
      batch: null,
      tenureLabel: '入职 1 年',
    });
    expect((await profileOf(data)).landing).toBeNull();
    data.employments[0].validFrom = '2027-01-01';
    expect((await profileOf(data)).person.tenureLabel).toBeNull();
    data.employments = [];
    expect((await profileOf(data)).person.tenureLabel).toBeNull();
    // A person without a batch and without hire data stays unknown.
    expect((await profileOf(fixture(), 'two')).person).toMatchObject({
      batch: null,
      tenureLabel: null,
    });
  });
  it('picks one batch: latest start, then smallest cohort id, inside the grants', async () => {
    const data = fixture();
    data.cohorts.push(
      { id: 'cohort-a', name: 'A' },
      { id: 'cohort-b', name: 'B' },
    );
    const enrol = (cohortId: string, validFrom: string, over = {}) =>
      data.context.enrollments.push({
        personId: 'one',
        cohortId,
        confirmed: true,
        validFrom,
        validTo: null,
        revokedAt: null,
        ...over,
      });
    enrol('cohort-b', '2026-03-01');
    enrol('cohort-a', '2026-03-01');
    expect((await profileOf(data)).person.batch).toEqual({
      id: 'cohort-a',
      name: 'A',
    });
    // Unconfirmed, revoked, ended and future enrolments are never selected.
    enrol('cohort-0', '2026-06-01', { confirmed: false });
    enrol('cohort-1', '2026-06-01', { revokedAt: '2026-06-02' });
    enrol('cohort-2', '2026-06-01', { validTo: '2026-06-15' });
    enrol('cohort-3', '2026-08-01');
    expect((await profileOf(data)).person.batch?.id).toBe('cohort-a');
    // A cohort outside the caller's grant is not visible to that caller.
    const hr = fixture('hr');
    hr.cohorts.push({ id: 'other-cohort', name: 'Other' });
    hr.context.enrollments.push({
      personId: 'one',
      cohortId: 'other-cohort',
      confirmed: true,
      validFrom: '2026-06-01',
      validTo: null,
      revokedAt: null,
    });
    expect((await profileOf(hr)).person.batch?.id).toBe('cohort');
  });
  it('names the only topic of the batch and its mentors, never guessing', async () => {
    const data = fixture();
    const topic = (id: string, over = {}) => {
      data.staffing.projects.push({
        id,
        name: 'Topic ' + id,
        type: 'topic',
        status: '进行中',
        goal: 'Synthetic goal',
        organizationId: 'org',
        cohortId: 'cohort',
        isTopic: true,
        ownerId: 'two',
        creatorId: 'two',
        from: '2026-01-01',
        to: '2026-12-01',
        sortOrder: 0,
        ...over,
      });
      data.staffing.members.push({
        id: 'member-' + id,
        projectId: id,
        personId: 'one',
        role: 'member',
        mode: 'full',
        validFrom: '2026-01-01',
        validTo: null,
        by: 'actor',
      });
    };
    expect((await profileOf(data)).landing).toEqual({
      topicName: null,
      mentorNames: ['Synthetic actor'],
    });
    topic('t1');
    expect((await profileOf(data)).landing?.topicName).toBe('Topic t1');
    topic('t2');
    expect((await profileOf(data)).landing?.topicName).toBeNull();
  });
});

describe('effective scores and conflicts', () => {
  it('shows insufficient and absent as states without a number', async () => {
    const data = fixture();
    data.confirmations[0].status = 'unknown';
    data.confirmations[0].value = null;
    data.confirmations[0].anchorId = null;
    data.confirmations[2].status = 'not_demonstrated';
    data.confirmations[2].value = null;
    data.confirmations[2].anchorId = null;
    const [first, second] = cards(await profileOf(data)).sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    expect(first.scores).toContainEqual({
      state: 'insufficient',
      dimensionId: 'prof',
      dimensionLabel: '专业度',
    });
    expect(second.scores).toContainEqual({
      state: 'absent',
      dimensionId: 'prof',
      dimensionLabel: '专业度',
    });
    const person = await profileOf(data);
    // Only the two remaining confirmed scores count; no zero is invented.
    expect(
      spectrum(person)
        .scores.map((row) => row.dimensionId)
        .sort(),
    ).toEqual(['grit', 'mot']);
  });
  it('counts a spread of 2 or more as a conflict that is counted nowhere', async () => {
    const data = fixture();
    addScore(data, { id: 'rival', eventId: 'event-0', value: 2 });
    const person = await profileOf(data);
    const conflicted = cards(person).find((row) => row.id === 'event-0')!;
    const conflict = conflicted.scores.find((row) => row.state === 'conflict');
    expect(conflict).toMatchObject({ state: 'conflict', dimensionId: 'prof' });
    expect(conflict).toHaveProperty('ratings.length', 2);
    expect(
      conflicted.scores.filter(
        (row) => row.state === 'confirmed' && row.dimensionId === 'prof',
      ),
    ).toHaveLength(0);
    // The conflicted event-dimension is absent from the spectrum, the lines
    // and the reference position; the other event's score remains.
    expect(
      spectrum(person).scores.filter((row) => row.dimensionId === 'prof'),
    ).toHaveLength(1);
    expect(person).toHaveProperty(
      'referencePosition.status',
      'insufficient_evidence',
    );
    const quick = await quickViewFromData(data, 'one');
    expect(quick?.capabilityLines).toMatchObject({
      status: 'ready',
      data: {
        lines: expect.arrayContaining([
          expect.objectContaining({ dimensionId: 'prof', eventCount: 1 }),
        ]),
      },
    });
  });
  it('keeps both ratings when the spread is below 2, counting events once', async () => {
    const data = fixture();
    addScore(data, { id: 'close', eventId: 'event-0', value: 3 });
    const person = await profileOf(data);
    const card = cards(person).find((row) => row.id === 'event-0')!;
    expect(
      card.scores.filter(
        (row) => row.state === 'confirmed' && row.dimensionId === 'prof',
      ),
    ).toHaveLength(2);
    expect(
      spectrum(person).scores.filter((row) => row.dimensionId === 'prof'),
    ).toHaveLength(3);
    const quick = await quickViewFromData(data, 'one');
    const lines =
      quick?.capabilityLines.status === 'ready'
        ? quick.capabilityLines.data.lines
        : [];
    expect(lines.find((row) => row.dimensionId === 'prof')).toEqual({
      dimensionId: 'prof',
      dimensionLabel: '专业度',
      eventCount: 2,
      topAnchor: 'Synthetic anchor',
    });
  });
  it('cuts the spectrum window at asOf minus 365 days, boundary included', async () => {
    const data = fixture();
    data.events[0].occurredOn = '2025-07-01';
    data.events[1].occurredOn = '2025-06-30';
    const person = await profileOf(data);
    const profile = spectrum(person);
    expect(profile.windowFrom).toBe('2025-07-01');
    expect(profile.scores.every((row) => row.eventId === 'event-0')).toBe(true);
    // The old card is still readable, so the hint asks for concrete behavior.
    expect(profile.dimensions.find((row) => row.id === 'grit')).toMatchObject({
      state: 'insufficient',
      missing: '有记录，待补具体行为',
    });
    // Potential core follows the prototype order, not the ID order.
    expect(profile.dimensions.map((row) => [row.id, row.group])).toEqual([
      ['prof', 'professional'],
      ['mot', 'potential_core'],
      ['grit', 'potential_core'],
    ]);
    // Old scores stay on the cards.
    expect(
      cards(person)
        .find((row) => row.id === 'event-1')!
        .scores.some((row) => row.state === 'confirmed'),
    ).toBe(true);
  });
  it('lists the bonus flag in the profile but not in the quick view', async () => {
    const data = fixture();
    const person = await profileOf(data);
    expect(person).toHaveProperty('referencePosition.data.bonus', false);
    const quick = await quickViewFromData(data, 'one');
    expect(quick).toHaveProperty('referencePosition.data.quadrant');
    expect(quick).not.toHaveProperty('referencePosition.data.bonus');
  });
});

describe('timeline entries', () => {
  it('carries participants, recorder, project name and cleaned SBI fields', async () => {
    const data = fixture();
    data.participants.push({ eventId: 'event-0', personId: 'two' });
    const card = cards(await profileOf(data)).find(
      (row) => row.id === 'event-0',
    )!;
    expect(card.participants).toEqual([
      { name: 'Synthetic one' },
      { name: 'Synthetic two' },
    ]);
    expect(card).not.toHaveProperty('selfRole');
    expect(card).not.toHaveProperty('projectName');
    expect(card).not.toHaveProperty('pendingScoreCount');
    expect(card).toMatchObject({
      recorderName: 'Synthetic actor',
      behavior: 'Synthetic behavior',
      impact: null,
      label: 'observation',
      category: 'evaluation',
    });
  });
  it('names the project only when the caller may read it', async () => {
    const data = fixture('hr');
    data.staffing.projects.push({
      id: 'p',
      name: 'Synthetic project',
      type: 'topic',
      status: '进行中',
      goal: 'Synthetic goal',
      organizationId: 'org',
      cohortId: 'cohort',
      isTopic: true,
      ownerId: 'two',
      creatorId: 'two',
      from: '2026-01-01',
      to: '2026-12-01',
      sortOrder: 0,
    });
    data.events[0].projectId = 'p';
    const named = cards(await profileOf(data)).find((r) => r.id === 'event-0')!;
    expect(named.projectName).toBe('Synthetic project');
    data.staffing.projects[0].cohortId = 'other-cohort';
    const hidden = cards(await profileOf(data)).find(
      (r) => r.id === 'event-0',
    )!;
    expect(hidden).not.toHaveProperty('projectName');
  });
  it('omits events without a source or a nameable recorder', async () => {
    const data = fixture();
    data.eventSources = data.eventSources.filter(
      (row) => row.eventId !== 'event-1',
    );
    data.events[0].recorderId = 'ghost';
    const person = await profileOf(data);
    expect(person.timeline.status).toBe('empty');
    expect(person.capabilityProfile).toEqual({
      status: 'insufficient_evidence',
      reason: '待补已确认的事件',
    });
  });
  it('adds self reports and classified history, orders newest first', async () => {
    const data = fixture();
    data.statements[1].kind = 'self_report';
    data.fragments.push({
      id: 'fragment-h',
      originalVersionId: 'version',
      excerpt: 'Synthetic history',
      location: { kind: 'snapshot_field', fieldPath: 'history' },
    });
    data.historical.push({
      id: 'history',
      sourceRecordId: 'snapshot-history',
      evaluationNodeId: null,
      personId: 'one',
      recorderId: 'actor',
      occurredOn: '2026-06-15',
      kind: '训练营周评',
      period: '第 3 周',
      scale: [['本周总结', '正常发挥']],
      ruleVersionId: null,
      originalVersionId: 'version',
      fragmentId: 'fragment-h',
      sourceCategory: 'prototype_baseline',
    });
    const person = await profileOf(data);
    if (person.timeline.status !== 'ready') throw new Error('no timeline');
    expect(person.timeline.data.map((row) => [row.kind, row.id])).toEqual([
      ['history', 'history'],
      ['key_event', 'event-0'],
      ['key_event', 'event-1'],
      ['self_report', 'statement-1'],
    ]);
    expect(person.timeline.data[0]).toMatchObject({
      title: '训练营周评 · 第 3 周',
      label: 'history',
      category: 'evaluation',
      scale: [['本周总结', '正常发挥']],
    });
    expect(person.timeline.data[3]).toMatchObject({
      label: 'self',
      title: 'Synthetic fact',
    });
    // History of an unclassified kind is hidden from every caller.
    data.historical[0].kind = 'Unclassified confidential material';
    const hidden = await profileOf(data);
    expect(
      hidden.timeline.status === 'ready' &&
        hidden.timeline.data.some((row) => row.kind === 'history'),
    ).toBe(false);
  });
  it('keeps human conclusions out of the summary until they carry a date', async () => {
    const data = fixture();
    expect((await profileOf(data)).summary).toEqual({ status: 'empty' });
    data.statements[0].kind = 'human_conclusion';
    const summary = (await profileOf(data)).summary;
    expect(summary.status).toBe('unknown');
    expect(JSON.stringify(summary)).not.toContain('Synthetic fact');
  });
});

describe('quick view and list', () => {
  const names = ['张三', '李四', '王五'];
  it('lists up to three newest readable facts with their sources', async () => {
    const data = fixture();
    for (let i = 2; i < 6; i++) {
      const reference = {
        fragmentId: 'fragment-' + i,
        originalVersionId: 'version',
      };
      data.events.push({
        ...data.events[0],
        id: 'event-' + i,
        occurredOn: `2026-06-0${i}`,
      });
      data.fragments.push({ ...data.fragments[0], id: reference.fragmentId });
      data.eventSources.push({ eventId: 'event-' + i, ...reference });
    }
    const quick = await quickViewFromData(data, 'one');
    if (quick?.recentFacts.status !== 'ready') throw new Error('no facts');
    expect(quick.recentFacts.data.map((row) => row.eventId)).toEqual([
      'event-5',
      'event-4',
      'event-3',
    ]);
    expect(quick.recentFacts.data[0].sources).toHaveLength(1);
  });
  it('carries no profile-only or provenance fields in the narrowed shape', async () => {
    const data = fixture();
    const quick = await quickViewFromData(data, 'one');
    expect(Object.keys(quick!).sort()).toEqual([
      'capabilityLines',
      'person',
      'projectLoad',
      'recentFacts',
      'referencePosition',
      'role',
    ]);
    const text = JSON.stringify(quick);
    for (const word of [
      'scoredByName',
      'ruleVersionId',
      'situation',
      'summary',
      'capabilityProfile',
    ])
      expect(text).not.toContain(word);
    expect(text).not.toMatch(/"value"|totalScore|ranking|percent/);
  });
  it('counts only readable projects, current and ever', async () => {
    const data = fixture('hr');
    const project = (id: string, cohortId: string) =>
      data.staffing.projects.push({
        id,
        name: 'Project ' + id,
        type: 'topic',
        status: '进行中',
        goal: 'Synthetic goal',
        organizationId: 'org',
        cohortId,
        isTopic: true,
        ownerId: 'two',
        creatorId: 'two',
        from: '2026-01-01',
        to: '2026-12-01',
        sortOrder: 0,
      });
    const member = (projectId: string, validTo: string | null) =>
      data.staffing.members.push({
        id: 'member-' + projectId,
        projectId,
        personId: 'one',
        role: 'member',
        mode: 'full',
        validFrom: '2026-01-01',
        validTo,
        by: 'actor',
      });
    project('open', 'cohort');
    member('open', null);
    project('ended', 'cohort');
    member('ended', '2026-05-01');
    project('hidden', 'other-cohort');
    member('hidden', null);
    const quick = await quickViewFromData(data, 'one');
    expect(quick?.projectLoad).toEqual({ current: 1, ever: 2 });
  });
  it('omits management content from the mentor variant, with sentinel text', async () => {
    const data = fixture('mentor');
    data.events[0].title = 'SENTINEL-title';
    data.events[0].situation = 'SENTINEL-situation';
    data.statements[0].kind = 'management_observation';
    const quick = await quickViewFromData(data, 'one');
    const profile = await profileOf(data);
    expect(quick).not.toHaveProperty('referencePosition');
    expect(JSON.stringify([quick, profile])).not.toContain('SENTINEL');
    expect(quick?.recentFacts.status).toBe('ready');
    const manager = fixture();
    manager.events[0].title = 'SENTINEL-title';
    manager.statements[0].kind = 'management_observation';
    expect(JSON.stringify(await quickViewFromData(manager, 'one'))).toContain(
      'SENTINEL-title',
    );
  });
  it('sorts by team then pinyin name then code point id, never by score', async () => {
    const data = fixture();
    for (const [index, name] of names.entries()) {
      const row = {
        id: 'id-' + index,
        name,
        organizationId: 'org',
        photo: null,
        hue: 10,
        noReview: false,
        demo: true,
      };
      // The directory and the authorization context share one array.
      data.directory.people.push(row);
    }
    data.directory.people.push({
      ...data.directory.people[3],
      id: 'id-9',
    });
    const list = await peopleFromData(data);
    expect(list.people.map((row) => row.person.id)).toEqual([
      'id-1',
      'id-2',
      'id-0',
      'id-9',
      'actor',
      'one',
      'two',
    ]);
    expect(list.total).toBe(7);
    expect(
      (await peopleFromData(data, { teamId: 'nowhere' })).people,
    ).toHaveLength(0);
  });
});

describe('source detail', () => {
  it('adds the original title and leaves the unknown recorder null', async () => {
    const data = fixture();
    const result = await sourceFromData(data, {
      fragmentId: 'fragment-0',
      originalVersionId: 'version',
    });
    expect(result).toMatchObject({
      status: 'success',
      source: {
        originalTitle: 'Synthetic snapshot',
        recordedByName: null,
        excerpt: 'Synthetic observation',
      },
    });
  });
});

describe('strict projection', () => {
  // DY-01: there is no employee view. An account reading its own person with
  // no grant and no evaluation relation gets no profile and no quick view.
  it.each(['hr', 'manager'] as const)(
    'an account whose %s grant is gone cannot read itself',
    async (role) => {
      const data = fixture(role);
      data.context.account.personId = 'one';
      // Control: the same self-read with the grant is a normal business read.
      expect(await personFromData(data, 'one')).not.toBeNull();
      data.context.grants = [];
      data.directory.grants = [];
      data.context.assignments = [];
      expect(await personFromData(data, 'one')).toBeNull();
      expect(await quickViewFromData(data, 'one')).toBeNull();
    },
  );
  it('gives the mentor a hidden-record hint identical to no record at all', async () => {
    const data = fixture('mentor');
    data.statements[1].kind = 'management_observation';
    const person = await profileOf(data);
    expect(person.role).toBe('mentor');
    expect(spectrum(person).dimensions.map((row) => row.id)).toEqual([
      'prof',
      'mot',
      'grit',
    ]);
    // event-1 carries the only grit score and is hidden from the mentor.
    expect(
      spectrum(person).dimensions.find((row) => row.id === 'grit'),
    ).toEqual({
      id: 'grit',
      label: expect.any(String),
      group: 'potential_core',
      state: 'insufficient',
      missing: '待补受挫后如何反应的事件',
    });
    expect(JSON.stringify(person)).not.toContain('有记录');
  });
  it('rejects a mentor response that carries management category content', async () => {
    const data = fixture('hr');
    data.statements[0].kind = 'management_observation';
    const person = await profileOf(data);
    expect(personSchema.safeParse({ ...person, role: 'mentor' }).success).toBe(
      false,
    );
  });
});
