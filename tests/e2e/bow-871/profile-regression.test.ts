import { describe, expect, it } from 'vitest';
import { personFromData } from '@/server/queries/person-projection';
import { sourceFromData } from '@/server/queries/sources';
import { fixture } from '@/server/queries/person-test-helpers';

describe('BOW-871 baseline C1/C2/C6: profile and original projection together', () => {
  it.each(['manager', 'hr'] as const)(
    '%s can open the exact version referenced by a visible confirmed score',
    async (role) => {
      const data = fixture(role);
      const person = await personFromData(data, 'one');
      expect(person?.capabilityProfile.status).toBe('ready');
      if (person?.capabilityProfile.status !== 'ready')
        throw new Error('Expected a usable confirmation fixture');
      const confirmation = person.capabilityProfile.data.scores[0];
      expect(confirmation.anchor).toBe('Synthetic anchor');
      expect(confirmation.ruleVersionId).toBe('rubric-v1');
      expect(confirmation.scoredByName).toBe('Synthetic actor');
      const citation = confirmation.sources[0];
      const result = await sourceFromData(data, citation);
      expect(result.status).toBe('success');
      if (result.status !== 'success')
        throw new Error('Expected a readable citation');
      expect(result.source.originalVersionId).toBe(citation.originalVersionId);
      expect(result.source.fragmentId).toBe(citation.fragmentId);
      expect(result.source.location).toEqual(citation.location);
      expect(result.source.sourceCategory).toBe('prototype_baseline');
      expect(result.source.demo).toBe(true);
    },
  );

  it('returns no talent profile or original to the system administrator', async () => {
    const data = fixture('admin');
    expect(await personFromData(data, 'one')).toBeNull();
    expect(
      await sourceFromData(data, {
        fragmentId: 'fragment-0',
        originalVersionId: 'version',
      }),
    ).toEqual({ status: 'not_found', message: '来源不存在或不可见' });
  });

  it('omits every quadrant-bearing profile field for a mentor', async () => {
    const person = await personFromData(fixture('mentor'), 'one');
    expect(person?.role).toBe('mentor');
    for (const key of [
      'referencePosition',
      'managementObservations',
      'calibrationHistory',
      'versionsAndChanges',
    ]) {
      expect(person).not.toHaveProperty(key);
    }
  });

  it.each(['manager', 'hr', 'mentor'] as const)(
    '%s profile payload has no overall score, ranking, percentage or confidence field',
    async (role) => {
      const person = await personFromData(fixture(role), 'one');
      expect(person).not.toBeNull();
      const forbidden = new Set([
        'totalScore',
        'overallScore',
        'overallTalentScore',
        'rank',
        'ranking',
        'abilityPercentage',
        'competencyPercentage',
        'confidence',
        'radar',
      ]);
      function inspect(value: unknown): void {
        if (Array.isArray(value)) value.forEach(inspect);
        else if (value !== null && typeof value === 'object') {
          for (const [key, entry] of Object.entries(value)) {
            expect(forbidden.has(key), `forbidden profile key: ${key}`).toBe(
              false,
            );
            inspect(entry);
          }
        }
      }
      inspect(person);
    },
  );

  it('keeps an AI inference out of the human summary and event timeline', async () => {
    const data = fixture('manager');
    data.statements[0] = {
      ...data.statements[0],
      kind: 'ai_inference',
      text: '演示：模型提出待人核对的假设。',
      modelVersion: 'demo-model-v1',
      uncertainty: '待核对',
    };
    const person = await personFromData(data, 'one');
    expect(person?.aiInferences.status).toBe('ready');
    if (person?.aiInferences.status !== 'ready')
      throw new Error('Expected a sourced AI inference');
    expect(person.aiInferences.data[0]).toMatchObject({
      id: 'statement-0',
      nature: 'ai_inference',
      text: '演示：模型提出待人核对的假设。',
    });
    expect(JSON.stringify(person.summary)).not.toContain('statement-0');
    expect(JSON.stringify(person.timeline)).not.toContain('statement-0');
  });

  it('suppresses a confirmed score whose source version no longer resolves', async () => {
    const data = fixture('manager');
    data.confirmations.forEach((confirmation) => {
      confirmation.originalVersionId = 'missing-version';
    });
    const person = await personFromData(data, 'one');
    expect(person?.capabilityProfile).toEqual({
      status: 'insufficient_evidence',
      reason: '近 12 个月暂无已确认的维度分',
    });
  });

  it('does not reclassify a demo snapshot as an original personnel document', async () => {
    const data = fixture('manager');
    data.directory.people[0].demo = false;
    expect(
      await sourceFromData(data, {
        fragmentId: 'fragment-0',
        originalVersionId: 'version',
      }),
    ).toEqual({ status: 'not_found', message: '来源不存在或不可见' });
    const person = await personFromData(data, 'one');
    expect(person?.capabilityProfile.status).toBe('insufficient_evidence');
  });
});
