import { beforeEach, describe, expect, it, vi } from 'vitest';
import { personSchema } from '../../contracts/person';
import { peopleListSchema } from '../../contracts/people';
import { sourceReadResultSchema } from '../../contracts/sources';
import { fixture } from './person-test-helpers';
import { personFromData } from './person-projection';
import { peopleFromData } from './people';
import { sourceFromData, readSourceForCurrentUser } from './sources';
import {
  readPersonForCurrentUser,
  readPersonPreviewForCurrentUser,
} from './person';
import { loadCurrentPersonData } from './person-session';
vi.mock('./person-session', () => ({ loadCurrentPersonData: vi.fn() }));
import { recordAudit } from '../platform/audit';
vi.mock('../db/client', () => ({ getDatabase: () => ({}) }));
vi.mock('../platform/audit', () => ({ recordAudit: vi.fn() }));
beforeEach(() => {
  vi.mocked(recordAudit)
    .mockReset()
    .mockResolvedValue('00000000-0000-4000-8000-000000000001');
});
const reference = {
  fragmentId: 'fragment-0',
  originalVersionId: 'version',
};

describe('people, profile and shared sources', () => {
  for (const role of ['manager', 'hr', 'mentor', 'admin'] as const)
    it(role + ' receives only its authorized strict projection', async () => {
      const data = fixture(role);
      const result = await personFromData(data, 'one');
      if (role === 'admin') {
        expect(result).toBeNull();
        await expect(peopleFromData(data)).rejects.toThrow('无权限');
        return;
      }
      expect(personSchema.safeParse(result).success).toBe(true);
      expect(result?.capabilityProfile.status).toBe('ready');
      if (role === 'mentor') {
        expect(result).not.toHaveProperty('referencePosition');
        expect(result).not.toHaveProperty('managementObservations');
        expect(result).not.toHaveProperty('versionsAndChanges');
      } else {
        expect(result).toHaveProperty('referencePosition.status', 'ready');
        expect(result).toHaveProperty(
          'calibrationHistory.status',
          'not_connected',
        );
        expect(result).toHaveProperty(
          'versionsAndChanges.status',
          'not_connected',
        );
      }
      const list = await peopleFromData(data);
      expect(peopleListSchema.safeParse(list).success).toBe(true);
      expect(list.total).toBe(role === 'manager' ? 3 : 1);
      const filtered = await peopleFromData(data, {
        query: 'ONE',
        teamId: 'org',
      });
      expect(filtered.total).toBe(1);
      expect(await personFromData(data, 'missing')).toBeNull();
    });
  it('rejects client roles, score sorting and invalid source input', async () => {
    for (const input of [{ role: 'manager' }, { sort: 'score' }])
      await expect(peopleFromData(fixture(), input)).rejects.toThrow();
    expect((await readSourceForCurrentUser({ role: 'manager' })).status).toBe(
      'validation_error',
    );
  });
  it('rechecks revoked grants and assignments and excludes noReview people', async () => {
    const data = fixture('mentor');
    expect(await personFromData(data, 'two')).toBeNull();
    data.context.assignments[0].validTo = data.context.now;
    expect(await personFromData(data, 'one')).toBeNull();
    data.context.assignments[0].validTo = null;
    data.context.grants[0].revokedAt = data.context.now;
    expect(await personFromData(data, 'one')).toBeNull();
    const manager = fixture();
    manager.directory.people[0].noReview = true;
    expect(await personFromData(manager, 'one')).toBeNull();
    const employee = fixture();
    employee.context.grants = [];
    expect(await personFromData(employee, 'one')).toBeNull();
  });
  it('keeps AI statements separate, never uses AI suggestions or unknown as a score', async () => {
    const data = fixture();
    data.confirmations[0].status = 'unknown';
    data.confirmations[0].value = null;
    data.confirmations[1].active = false;
    data.statements[0].kind = 'ai_inference';
    const result = await personFromData(data, 'one');
    expect(result?.capabilityProfile).toHaveProperty('data.scores.length', 2);
    expect(result?.aiInferences).toHaveProperty(
      'data.0.nature',
      'ai_inference',
    );
    expect(result).toHaveProperty(
      'referencePosition.status',
      'insufficient_evidence',
    );
    expect(JSON.stringify(result)).not.toMatch(/totalScore|confidence|ranking/);
  });
  it('authorizes every subject sharing a source before derived values', async () => {
    const data = fixture('mentor');
    data.participants.push({ eventId: 'event-0', personId: 'two' });
    const source = await sourceFromData(data, reference);
    expect(source.status).toBe('not_found');
    const profile = await personFromData(data, 'one');
    expect(profile?.capabilityProfile).toHaveProperty('data.scores.length', 2);
    expect(profile?.timeline).toHaveProperty('data.length', 1);
    data.eventSources.push({
      eventId: 'event-1',
      fragmentId: 'fragment-0',
      originalVersionId: 'version',
    });
    data.events[1].personId = 'two';
    expect((await sourceFromData(data, reference)).status).toBe('not_found');
  });
  it('protects mixed management fragments, not just the observation field', async () => {
    const data = fixture('mentor');
    data.statements[0].kind = 'management_observation';
    const profile = await personFromData(data, 'one');
    expect(profile).not.toHaveProperty('managementObservations');
    expect(profile?.capabilityProfile).toHaveProperty('data.scores.length', 2);
    expect((await sourceFromData(data, reference)).status).toBe('not_found');
  });
  it('marks baseline origin and snapshot position, rejects wrong version or non-demo provenance', async () => {
    const data = fixture();
    const result = await sourceFromData(data, reference);
    expect(sourceReadResultSchema.safeParse(result).success).toBe(true);
    expect(result).toHaveProperty(
      'source.sourceCategory',
      'prototype_baseline',
    );
    expect(result).toHaveProperty('source.location.kind', 'snapshot_field');
    expect(result).toHaveProperty('source.displayNotice');
    expect(JSON.stringify(result)).not.toMatch(
      /sourceBlob|sourceCommit|storageKey|playback/,
    );
    expect(
      (await sourceFromData(data, { ...reference, originalVersionId: 'wrong' }))
        .status,
    ).toBe('not_found');
    data.events[0].demo = false;
    expect((await sourceFromData(data, reference)).status).toBe('not_found');
    expect(
      (await personFromData(data, 'one'))?.capabilityProfile,
    ).toHaveProperty('data.scores.length', 2);
  });
  it('keeps old evidence in the timeline, but not the reference position window', async () => {
    const data = fixture();
    data.events.forEach((event) => {
      event.occurredOn = '2020-01-01';
    });
    const result = await personFromData(data, 'one');
    expect(result?.timeline).toHaveProperty('data.length', 2);
    // The spectrum only holds the last 12 months; older scores stay on the cards.
    expect(result?.capabilityProfile.status).toBe('insufficient_evidence');
    expect(result).toHaveProperty(
      'referencePosition.status',
      'insufficient_evidence',
    );
  });
  it('returns source read errors rather than swallowing data-load failures', async () => {
    vi.mocked(loadCurrentPersonData).mockResolvedValue(fixture());
    expect((await readSourceForCurrentUser(reference)).status).toBe('success');
    expect((await readPersonForCurrentUser({ id: 'one' })).status).toBe(
      'success',
    );
    expect((await readPersonPreviewForCurrentUser({ id: 'one' })).status).toBe(
      'success',
    );
    expect((await readPersonForCurrentUser({ id: 'missing' })).status).toBe(
      'not_found',
    );
    vi.mocked(loadCurrentPersonData).mockRejectedValue(
      new Error('database failed'),
    );
    await expect(readSourceForCurrentUser(reference)).rejects.toThrow(
      'database failed',
    );
  });
  it('audits each successful sensitive read with current actor and resource', async () => {
    vi.mocked(loadCurrentPersonData).mockResolvedValue(fixture('hr'));
    await readPersonForCurrentUser({ id: 'one' });
    await readPersonPreviewForCurrentUser({ id: 'one' });
    await readSourceForCurrentUser(reference);
    expect(recordAudit).toHaveBeenCalledTimes(3);
    expect(recordAudit).toHaveBeenNthCalledWith(
      1,
      {},
      {
        actorId: 'account',
        action: 'person.read',
        resourceId: 'one',
      },
    );
    expect(recordAudit).toHaveBeenNthCalledWith(
      2,
      {},
      {
        actorId: 'account',
        action: 'person.read',
        resourceId: 'one',
      },
    );
    expect(recordAudit).toHaveBeenNthCalledWith(
      3,
      {},
      {
        actorId: 'account',
        action: 'source.read',
        resourceId: '["fragment-0","version"]',
      },
    );
  });
  it('never returns sensitive data when audit persistence fails', async () => {
    vi.mocked(loadCurrentPersonData).mockResolvedValue(fixture());
    vi.mocked(recordAudit).mockRejectedValue(new Error('audit unavailable'));
    const profile = readPersonForCurrentUser({ id: 'one' });
    await expect(profile).rejects.toThrow('audit unavailable');
    const preview = readPersonPreviewForCurrentUser({ id: 'one' });
    await expect(preview).rejects.toThrow('audit unavailable');
    const source = readSourceForCurrentUser(reference);
    await expect(source).rejects.toThrow('audit unavailable');
  });
  it('does not log a successful access for absent or denied resources', async () => {
    vi.mocked(loadCurrentPersonData).mockResolvedValue(fixture('mentor'));
    const profile = await readPersonForCurrentUser({ id: 'two' });
    expect(profile.status).toBe('not_found');
    const source = await readSourceForCurrentUser({
      ...reference,
      originalVersionId: 'missing',
    });
    expect(source.status).toBe('not_found');
    const invalid = await readSourceForCurrentUser({});
    expect(invalid.status).toBe('validation_error');
    expect(recordAudit).not.toHaveBeenCalled();
  });
  it('awaits audit persistence before resolving the profile', async () => {
    vi.mocked(loadCurrentPersonData).mockResolvedValue(fixture());
    let complete!: (id: Awaited<ReturnType<typeof recordAudit>>) => void;
    const persistence = new Promise<Awaited<ReturnType<typeof recordAudit>>>(
      (resolve) => {
        complete = resolve;
      },
    );
    vi.mocked(recordAudit).mockReturnValue(persistence);
    let returned = false;
    const pending = readPersonForCurrentUser({ id: 'one' }).then((result) => {
      returned = true;
      return result;
    });
    await vi.waitFor(() => expect(recordAudit).toHaveBeenCalledOnce());
    expect(returned).toBe(false);
    complete('00000000-0000-4000-8000-000000000002');
    expect((await pending).status).toBe('success');
  });
  it('does not infer compatibility between rule versions', async () => {
    const data = fixture();
    data.confirmations[0].ruleVersionId = 'future-rule';
    data.anchors.find((row) => row.id === 'prof')!.ruleVersionId =
      'future-rule';
    const profile = await personFromData(data, 'one');
    expect(profile?.capabilityProfile.status).toBe('ready');
    expect(profile).toHaveProperty('referencePosition.status', 'unknown');
  });
  it('classifies known baseline history but fails closed on unknown shared history', async () => {
    const data = fixture('mentor');
    data.historical.push({
      id: 'history',
      sourceRecordId: 'snapshot-history',
      evaluationNodeId: null,
      personId: 'one',
      recorderId: 'actor',
      occurredOn: '2026-06-01',
      kind: '训练营周评',
      period: null,
      scale: [['本周总结', '正常发挥']],
      ruleVersionId: null,
      originalVersionId: 'version',
      fragmentId: 'fragment-0',
      sourceCategory: 'prototype_baseline',
    });
    expect((await sourceFromData(data, reference)).status).toBe('success');
    data.historical[0].kind = 'Unclassified confidential material';
    expect((await sourceFromData(data, reference)).status).toBe('not_found');
    data.historical[0].kind = '结营评审';
    data.historical[0].personId = null;
    expect((await sourceFromData(data, reference)).status).toBe('not_found');
    data.historicalParticipants.push({
      evaluationId: 'history',
      personId: 'two',
    });
    expect((await sourceFromData(data, reference)).status).toBe('not_found');
  });
  it('fails closed on an unresolved event sharing an existing fragment', async () => {
    const data = fixture('mentor');
    data.eventSources.push({ ...reference, eventId: 'unresolved-event' });
    const source = await sourceFromData(data, reference);
    expect(source.status).toBe('not_found');
    const profile = await personFromData(data, 'one');
    expect(profile?.capabilityProfile).toHaveProperty('data.scores.length', 2);
  });
});

it('keeps authorized observation category in timelines and rejects it for mentors', async () => {
  const data = fixture('hr');
  data.statements[0].kind = 'management_observation';
  const profile = await personFromData(data, 'one');
  expect(profile?.timeline.status).toBe('ready');
  if (profile?.timeline.status !== 'ready') throw new Error('Missing timeline');
  const observation = profile.timeline.data.find(
    (row) => row.id === data.events[0].id,
  );
  expect(observation).toMatchObject({
    kind: 'key_event',
    label: 'observation',
    category: 'management-observation',
  });
  expect(observation?.sources).toHaveLength(1);
  const mentor = fixture('mentor');
  mentor.statements[0].kind = 'management_observation';
  const restricted = await personFromData(mentor, 'one');
  expect(restricted?.timeline).toHaveProperty('data.length', 1);
  expect(JSON.stringify(restricted)).not.toContain('management-observation');
  expect(
    personSchema.safeParse({ ...restricted, timeline: profile.timeline })
      .success,
  ).toBe(false);
});
it('retains ended non-owner participation only under current project authorization', async () => {
  const data = fixture('hr');
  data.staffing.projects.push({
    id: 'past-project',
    name: 'Synthetic past project',
    type: 'topic',
    status: '已结束',
    goal: 'Synthetic goal',
    organizationId: 'org',
    cohortId: 'cohort',
    isTopic: true,
    ownerId: 'two',
    creatorId: 'two',
    from: '2026-01-01',
    to: '2026-05-01',
    sortOrder: 0,
  });
  data.staffing.members.push({
    id: 'past-member',
    projectId: 'past-project',
    personId: 'one',
    role: 'member',
    mode: 'full',
    validFrom: '2026-01-01',
    validTo: '2026-05-01',
    by: 'actor',
  });
  const profile = await personFromData(data, 'one');
  expect(profile?.projects).toHaveProperty('data.0', {
    id: 'past-project',
    name: 'Synthetic past project',
    role: 'member',
    mode: 'full',
    from: '2026-01-01',
    to: '2026-05-01',
  });
  data.staffing.projects[0].cohortId = 'other-cohort';
  expect((await personFromData(data, 'one'))?.projects.status).toBe('empty');
  data.staffing.projects[0].cohortId = 'cohort';
  data.staffing.members[0].validFrom = '2027-01-01';
  expect((await personFromData(data, 'one'))?.projects.status).toBe('empty');
});
