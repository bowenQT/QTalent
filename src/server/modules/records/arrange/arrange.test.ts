import { describe, expect, it, vi } from 'vitest';
import {
  createFakeMaas,
  metadataFor,
  type StructuredMaasClient,
} from '../../../integrations/maas';
import { arrangeRecord, prepareArrange, type ArrangeSnapshot } from './index';
import { arrangeExamples, exampleSnapshot, exampleResponse } from './examples';

async function run(
  snapshot = exampleSnapshot(),
  output: unknown = exampleResponse(),
) {
  const client = createFakeMaas(output);
  const generate = vi.spyOn(client, 'generateStructured');
  const result = await arrangeRecord(async () => snapshot, client);
  return { result, generate };
}
describe('authorized shared record arrangement', () => {
  it.each(arrangeExamples)(
    '$id uses the shared entry and preserves provenance',
    async (example) => {
      const snapshot = exampleSnapshot(example);
      const { result, generate } = await run(
        snapshot,
        exampleResponse(example),
      );
      expect(result.status).toBe('arranged');
      if (result.status !== 'arranged') throw new Error('expected draft');
      expect(result.value.draft.origin).toBe(example.origin);
      expect(result.value.draft.sbi.situation).toBe('');
      expect(result.value.draft.sbi.behavior).toBe(example.text);
      expect(result.value.draft.originalInput).toEqual(snapshot.originalInput);
      expect(result.value.promptVersion).toBe('record-arrange.v1');
      expect(result.value.ruleVersionId).toBe('rule-current');
      expect(result.value.evidence[0]).toMatchObject({
        personId: example.personId,
        suggestedValue: 4,
        modelVersion: 'deepseek/deepseek-v4.1-flash',
        rationale: '',
      });
      expect(result.value).not.toHaveProperty('confirmedAt');
      expect(generate).toHaveBeenCalledOnce();
    },
  );
  it('only sends requested authorized excerpts, never generic fields or other events', async () => {
    const snapshot = exampleSnapshot();
    snapshot.authorization.records[0]!.fields.push({
      name: 'private-summary',
      kind: 'evaluation',
      value: 'VISIBLE_BUT_UNNEEDED',
      subjects: [],
      sources: [],
    });
    snapshot.authorization.sources.push({
      ...snapshot.authorization.sources[0]!,
      fragmentId: 'unrequested',
      excerpt: 'OTHER_EVENT',
    });
    snapshot.authorization.records[0]!.fields.push({
      name: 'other',
      kind: 'evaluation',
      value: 'OTHER_EVENT',
      subjects: [],
      sources: [
        { fragmentId: 'unrequested', originalVersionId: 'original-v1' },
      ],
    });
    const { generate } = await run(snapshot);
    const sent = JSON.stringify(generate.mock.calls[0]![0].messages);
    expect(sent).toContain(arrangeExamples[0]!.text);
    expect(sent).not.toMatch(
      /VISIBLE_BUT_UNNEEDED|OTHER_EVENT|private-summary/,
    );
  });
  it.each(['input', 'source'] as const)(
    'keeps padded/newline %s citations exact, including UTF-16 input offsets',
    async (kind) => {
      const snapshot = exampleSnapshot();
      const text = '🙂前缀 \n林舟补写回滚步骤。\n ';
      const quote = ' \n林舟补写回滚步骤。\n ';
      const start = text.indexOf(quote);
      snapshot.originalInput.text = text;
      snapshot.authorization.sources[0]!.excerpt = text;
      snapshot.authorization.records[0]!.fields[0]!.value = text;
      const response = exampleResponse();
      const score = response.scores[0]!;
      if (score.state !== 'suggested') throw new Error('fixture');
      const citation =
        kind === 'input'
          ? { kind, quote, start, end: start + quote.length }
          : {
              kind,
              quote,
              reference: {
                fragmentId: 'fragment-text',
                originalVersionId: 'original-v1',
                location: snapshot.authorization.sources[0]!.location,
              },
            };
      score.citations = [citation];
      const { result } = await run(snapshot, response);
      expect(result.status).toBe('arranged');
      if (result.status !== 'arranged') throw new Error('expected draft');
      expect(result.value.draft.originalInput.text).toBe(text);
      expect(result.value.draft.scores[0]).toMatchObject({
        state: 'suggested',
        citations: [citation],
      });
      expect(result.value.evidence[0]).toMatchObject({
        fragmentId: 'fragment-text',
        originalVersionId: 'original-v1',
      });
    },
  );
  it.each(['missing', 'outside', 'mixed', 'performance'] as const)(
    'refuses %s provenance without a model call',
    async (kind) => {
      const snapshot = exampleSnapshot();
      if (kind === 'missing') snapshot.authorization.sources = [];
      if (kind === 'outside')
        snapshot.authorization.sources[0]!.subjects = [
          { personId: 'hidden', cohortId: 'other' },
        ];
      if (kind === 'mixed')
        snapshot.authorization.sources[0]!.subjects.push({
          personId: 'hidden',
          cohortId: 'other',
        });
      if (kind === 'performance')
        snapshot.authorization.sources[0]!.requiredKinds = ['performance'];
      const { result, generate } = await run(snapshot);
      expect(result).toEqual({ status: 'not_found' });
      expect(generate).not.toHaveBeenCalled();
    },
  );
  it('does not identify a unique candidate or send unbound text', async () => {
    const snapshot = exampleSnapshot();
    snapshot.people = [
      {
        state: 'needs_selection',
        candidates: [{ id: 'demo-lin', label: '林舟（演示）' }],
        reason: '请记录人选定',
      },
    ];
    snapshot.originalInput.personId = null;
    snapshot.authorization.sources[0]!.subjects = [];
    snapshot.requestedSources[0]!.attributedPersonIds = [];
    const { result, generate } = await run(snapshot);
    expect(result.status).toBe('selection_required');
    if (result.status === 'selection_required')
      expect(result.people[0]!.state).toBe('needs_selection');
    expect(generate).not.toHaveBeenCalled();
  });
  it.each(['recording', 'attachment'] as const)(
    'does not reveal selection input from unauthorized %s sources before a person is selected',
    async (origin) => {
      const snapshot = exampleSnapshot();
      snapshot.origin = origin;
      snapshot.inputSource = null;
      snapshot.people = [
        {
          state: 'needs_selection',
          candidates: [{ id: 'demo-lin', label: '林舟（演示）' }],
          reason: '请记录人选定',
        },
      ];
      snapshot.authorization.sources[0]!.subjects.push({
        personId: 'hidden',
        cohortId: 'other',
      });
      const { result, generate } = await run(snapshot);
      expect(result).toEqual({ status: 'not_found' });
      expect(generate).not.toHaveBeenCalled();
    },
  );
  it('uses the actual content cohort for an authorized current-cohort person before enrollment confirmation', async () => {
    const snapshot = exampleSnapshot();
    snapshot.authorization.context.enrollments[0]!.confirmed = false;
    const { result, generate } = await run(snapshot);
    expect(result.status).toBe('arranged');
    expect(generate).toHaveBeenCalledOnce();
  });
  it('still refuses prior-cohort content before enrollment confirmation', async () => {
    const snapshot = exampleSnapshot();
    snapshot.authorization.context.enrollments[0]!.confirmed = false;
    snapshot.authorization.records[0]!.subject.cohortId = 'cohort-prior';
    snapshot.authorization.sources[0]!.subjects[0]!.cohortId = 'cohort-prior';
    const { result, generate } = await run(snapshot);
    expect(result).toEqual({ status: 'not_found' });
    expect(generate).not.toHaveBeenCalled();
  });
  it('keeps project ambiguity for human selection while arranging selected people', async () => {
    const snapshot = exampleSnapshot();
    snapshot.project = {
      state: 'needs_selection',
      candidates: [],
      reason: '请确认项目',
    };
    const { result } = await run(snapshot);
    expect(result.status).toBe('arranged');
    if (result.status === 'arranged')
      expect(result.value.draft.project.state).toBe('needs_selection');
  });
  it.each([
    'quote',
    'version',
    'location',
    'input-offset',
    'input-origin',
    'attribution',
  ] as const)(
    'downgrades an invalid %s to unknown without invented evidence',
    async (kind) => {
      const snapshot = exampleSnapshot();
      const output = exampleResponse();
      const score = output.scores[0]!;
      if (score.state !== 'suggested') throw new Error('fixture');
      if (kind === 'input-offset')
        score.citations = [
          { kind: 'input', quote: arrangeExamples[0]!.text, start: 1, end: 2 },
        ];
      else if (kind === 'input-origin') {
        snapshot.origin = 'attachment';
        score.citations = [
          {
            kind: 'input',
            quote: arrangeExamples[0]!.text,
            start: 0,
            end: arrangeExamples[0]!.text.length,
          },
        ];
      } else if (kind === 'attribution')
        snapshot.requestedSources[0]!.attributedPersonIds = [];
      else {
        const citation = score.citations[0]!;
        if (citation.kind !== 'source') throw new Error('fixture');
        if (kind === 'quote') citation.quote = '虚构行为';
        if (kind === 'version')
          citation.reference.originalVersionId = 'old-version';
        if (kind === 'location')
          citation.reference.location = {
            kind: 'document',
            paragraph: 'wrong',
          };
      }
      const { result } = await run(snapshot, output);
      expect(result.status).toBe('arranged');
      if (result.status !== 'arranged') throw new Error('expected unknown');
      expect(result.value.draft.scores[0]).toMatchObject({
        state: 'unknown',
        reason: '引用未通过来源或个人归属校验',
      });
      expect(result.value.evidence).toEqual([]);
      expect(JSON.stringify(result)).not.toContain('虚构行为');
    },
  );
  it.each(['version', 'dimension', 'value', 'text'] as const)(
    'checks current anchor %s',
    async (kind) => {
      const output = exampleResponse();
      const score = output.scores[0]!;
      if (score.state !== 'suggested') throw new Error('fixture');
      if (kind === 'version') score.anchor.ruleVersion = 'rule-old';
      if (kind === 'dimension') score.anchor.id = 'anchor-other';
      if (kind === 'value') score.value = 5;
      if (kind === 'text') score.anchor.text = '编造锚点';
      const { result } = await run(exampleSnapshot(), output);
      expect(result.status).toBe('arranged');
      if (result.status === 'arranged') {
        expect(result.value.draft.scores[0]).toMatchObject({
          state: 'unknown',
          reason: '锚点不属于当前生效规则',
        });
        expect(result.value.evidence).toEqual([]);
      }
    },
  );
  it.each(['identity', 'dimension', 'duplicate', 'structure'] as const)(
    'fails %s output without retrying',
    async (kind) => {
      const output = exampleResponse();
      if (kind === 'identity') output.scores[0]!.personId = 'hidden';
      if (kind === 'dimension') output.scores[0]!.dimensionId = 'made-up';
      if (kind === 'duplicate')
        output.scores.push(structuredClone(output.scores[0]!));
      const { result, generate } = await run(
        exampleSnapshot(),
        kind === 'structure' ? { sbi: { behavior: '' } } : output,
      );
      expect(result).toMatchObject({
        status: 'failed',
        failure: { kind: 'invalid_response', retryable: false },
      });
      expect(generate).toHaveBeenCalledOnce();
    },
  );
  it('allows input citations only at exact authorized UTF-16 offsets', async () => {
    const snapshot = exampleSnapshot();
    const output = exampleResponse();
    const score = output.scores[0]!;
    if (score.state !== 'suggested') throw new Error('fixture');
    score.citations = [
      {
        kind: 'input',
        quote: snapshot.originalInput.text,
        start: 0,
        end: snapshot.originalInput.text.length,
      },
    ];
    const { result } = await run(snapshot, output);
    expect(result.status).toBe('arranged');
    if (result.status === 'arranged')
      expect(result.value.evidence[0]!.fragmentId).toBe('fragment-text');
  });
  it('supports independently attributed people without copying scores', async () => {
    const snapshot = exampleSnapshot();
    snapshot.people.push({ state: 'resolved', id: 'demo-xu' });
    snapshot.authorization.sources[0]!.subjects.push({
      personId: 'demo-xu',
      cohortId: 'cohort-demo',
    });
    const output = exampleResponse();
    const second = structuredClone(output.scores[0]!);
    second.personId = 'demo-xu';
    output.scores.push(second);
    const { result } = await run(snapshot, output);
    expect(result.status).toBe('arranged');
    if (result.status === 'arranged') {
      expect(result.value.draft.people).toHaveLength(2);
      expect(result.value.draft.scores.map((s) => s.state)).toEqual([
        'suggested',
        'unknown',
      ]);
      expect(result.value.evidence).toHaveLength(1);
    }
  });
  it('does not invent evidence or a numeric value for unknown', async () => {
    const { result } = await run(exampleSnapshot(), {
      sbi: exampleResponse().sbi,
      scores: [
        {
          state: 'unknown',
          personId: 'demo-lin',
          dimensionId: 'judgment',
          reason: '资料不足',
        },
      ],
    });
    expect(result.status).toBe('arranged');
    if (result.status === 'arranged') {
      expect(result.value.evidence).toEqual([]);
      expect(result.value.draft.scores[0]).not.toHaveProperty('value');
    }
  });
  it('does not give the persistence port an evidence row absent from the normalized score citations', async () => {
    const output = exampleResponse();
    const score = output.scores[0]!;
    if (score.state !== 'suggested') throw new Error('fixture');
    score.anchor.ruleVersion = 'rule-old';
    const { result } = await run(exampleSnapshot(), output);
    if (result.status !== 'arranged') throw new Error('expected unknown');
    expect(result.value.draft.scores[0]!.state).toBe('unknown');
    expect(result.value.evidence).toEqual([]);
  });
  it.each([
    'network',
    'outcome_unknown',
    'invalid_response',
    'cancelled',
  ] as const)('preserves safe retry classification for %s', async (kind) => {
    const client: StructuredMaasClient = {
      async generateStructured(input) {
        return {
          ok: false,
          kind,
          retryable: true,
          metadata: metadataFor(input),
        };
      },
    };
    const generate = vi.spyOn(client, 'generateStructured');
    const result = await arrangeRecord(async () => exampleSnapshot(), client);
    expect(result).toMatchObject({
      status: 'failed',
      failure: { kind, retryable: kind === 'network' },
    });
    expect(generate).toHaveBeenCalledOnce();
  });
  it('does not use a previously authorized load or mutate user input', async () => {
    const snapshot = exampleSnapshot();
    const before = structuredClone(snapshot);
    const load = vi.fn(async (): Promise<ArrangeSnapshot | null> => null);
    expect(
      await arrangeRecord(load, createFakeMaas(exampleResponse())),
    ).toEqual({ status: 'not_found' });
    expect(load).toHaveBeenCalledOnce();
    await prepareArrange(snapshot);
    expect(snapshot).toEqual(before);
  });
});
