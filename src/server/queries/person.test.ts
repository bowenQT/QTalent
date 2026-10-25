import { describe, expect, it, vi } from 'vitest';
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
    expect(result?.capabilityProfile).toHaveProperty('data.length', 2);
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
    expect(profile?.capabilityProfile).toHaveProperty('data.length', 2);
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
    expect(profile?.capabilityProfile).toHaveProperty('data.length', 2);
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
    ).toHaveProperty('data.length', 2);
  });
  it('keeps old evidence in the timeline, but not the reference position window', async () => {
    const data = fixture();
    data.events.forEach((event) => {
      event.occurredOn = '2020-01-01';
    });
    const result = await personFromData(data, 'one');
    expect(result?.timeline).toHaveProperty('data.length', 2);
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
});
