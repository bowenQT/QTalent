import { createHash } from 'node:crypto';
import { z } from 'zod';
import { evidenceRecordsSchema, type EvidenceRecords } from './evidence-input';

const id = z.string().min(1);
const number = z.number().int().min(1).max(5);
const score = z
  .object({
    p: id,
    d: id,
    v: number.nullable().optional(),
    st: z.enum(['confirmed', 'conflict', 'ai', 'unknown', 'not_demonstrated']),
    by: id.nullable().optional(),
    ai: number.optional(),
    note: z.string().optional(),
    raters: z
      .array(z.object({ by: id, v: number, why: z.string().optional() }))
      .optional(),
    bigGap: z.boolean().optional(),
  })
  .passthrough();
export const EVIDENCE_BASELINE = '2e51b50';
export const BASELINE_NOTICE = '原型基线 2e51b50，评语按原意压缩';
export const DEMO_RULE_VERSION = 'rubric-v1';
export const WEEKLY_RULE_VERSION = 'xe-weekly-v1';
export const EVIDENCE_SOURCES = {
  'data-xe6.js': {
    path: 'prototype/y/app/js/data-xe6.js',
    blob: '54b8c41229fa220a79e20eef48afafa71af81c79',
    digest: 'e091963074607e3d844d2b89b2cdf2cc74105afb8141aca0dcd334f09402197b',
  },
  'data.js': {
    path: 'prototype/y/app/js/data.js',
    blob: '48cacc14105d496159e633dd392128629f03e3f9',
    digest: '9c649375f6d1e77cbfcf1c163b3c23627447127d89f6ece2155ad9f6262c5e29',
  },
} as const;
type SourceFile = keyof typeof EVIDENCE_SOURCES;
const sourceFile = z.enum(['data-xe6.js', 'data.js']);
export const evidenceSeedFields = {
  DIMS: z
    .array(
      z.object({
        id,
        name: id,
        axis: z.enum(['prof', 'pot']),
        core: z.boolean(),
      }),
    )
    .default([]),
  ANCHORS: z
    .object({ prof: z.array(id).length(5), pot: z.array(id).length(5) })
    .optional(),
  SNAPSHOT_FIELD_SOURCES: z.record(z.string(), sourceFile).default({}),
  EVENTS: z
    .array(
      z
        .object({
          id,
          date: z.iso.date(),
          kind: z.enum(['obs', 'hist']),
          people: z.array(id),
          recorder: id,
          title: id,
          project: id.optional(),
          bg: z.string().optional(),
          act: z.string().optional(),
          res: z.string().optional(),
          gap: z.string().optional(),
          week: z.string().optional(),
          sum: z.string().nullable().optional(),
          histType: z.string().optional(),
          scale: z.array(z.tuple([z.string(), z.string()])).optional(),
          srcs: z.array(
            z
              .object({
                type: id,
                label: id,
                loc: z.string().optional(),
                quote: z.string().optional(),
              })
              .passthrough(),
          ),
          scores: z.array(score),
        })
        .passthrough(),
    )
    .default([]),
};
export type ImportGap = { recordId: string; missing: string[] };
export class EvidenceMappingError extends Error {
  readonly gaps: ImportGap[];
  constructor(recordId: string, missing: string) {
    super(recordId + ': ' + missing);
    this.name = 'EvidenceMappingError';
    this.gaps = [{ recordId, missing: [missing] }];
  }
}
const stableId = (kind: string, key: string) =>
  'demo-' +
  kind +
  '-' +
  createHash('sha256')
    .update(EVIDENCE_BASELINE + ':' + key)
    .digest('hex')
    .slice(0, 24);
export type EvidenceSeed = EvidenceRecords & {
  dimensions: {
    id: string;
    name: string;
    axis: 'prof' | 'pot';
    core: boolean;
  }[];
  ruleVersions: {
    id: string;
    provenance: 'demo_import_snapshot';
    sourceCommit: string;
  }[];
  anchors: {
    id: string;
    dimensionId: string;
    ruleVersionId: string;
    value: number;
    text: string;
  }[];
  snapshots: {
    id: string;
    recordId: string;
    sourceCommit: string;
    fieldPath: string;
    provenance: 'demo_import_snapshot';
    content: unknown;
  }[];
  gaps: ImportGap[];
};

/** Only the digest-pinned loader determines which evaluated snapshot owns a field. */
export function snapshotFieldSources(
  first: unknown,
  final: unknown,
): Record<string, SourceFile> {
  const eventsSchema = z.array(
    z
      .object({
        id,
        srcs: z.array(z.unknown()),
        scores: z.array(
          z.object({ raters: z.array(z.unknown()).optional() }).passthrough(),
        ),
      })
      .passthrough(),
  );
  const previous = new Map(eventsSchema.parse(first).map((e) => [e.id, e]));
  const sources: Record<string, SourceFile> = {};
  for (const event of eventsSchema.parse(final)) {
    const original = previous.get(event.id);
    const base = 'events[' + event.id + ']';
    const set = (field: string, value: unknown, before: unknown) => {
      sources[base + '.' + field] =
        before !== undefined && JSON.stringify(before) === JSON.stringify(value)
          ? 'data-xe6.js'
          : 'data.js';
    };
    for (const key of ['act', 'sum', 'scale'])
      if (event[key] !== undefined) set(key, event[key], original?.[key]);
    event.srcs.forEach((s, i) => set('srcs[' + i + ']', s, original?.srcs[i]));
    event.scores.forEach((s, i) => {
      set('scores[' + i + ']', s, original?.scores[i]);
      s.raters?.forEach((r, j) =>
        set(
          'scores[' + i + '].raters[' + j + ']',
          r,
          original?.scores[i]?.raters?.[j],
        ),
      );
    });
  }
  return sources;
}

/** Snapshots prove prototype fields, never the original HR observation document. */
export function mapEvidenceSeed(input: unknown): EvidenceSeed {
  const raw = z.object(evidenceSeedFields).parse(input);
  const records = evidenceRecordsSchema.parse({});
  const gaps: ImportGap[] = [];
  const seen = new Set<string>();
  for (const row of [...raw.DIMS, ...raw.EVENTS]) {
    if (seen.has(row.id))
      throw new EvidenceMappingError(row.id, 'duplicateIdentity');
    seen.add(row.id);
  }
  if (raw.DIMS.length && !raw.ANCHORS)
    throw new EvidenceMappingError('ANCHORS', 'anchors');
  if (raw.EVENTS.some((e) => e.kind === 'obs') && !raw.DIMS.length)
    throw new EvidenceMappingError('DIMS', 'ruleVersionId');
  const dimensions = raw.DIMS;
  const ruleVersions: EvidenceSeed['ruleVersions'] = raw.DIMS.length
    ? [
        {
          id: DEMO_RULE_VERSION,
          provenance: 'demo_import_snapshot',
          sourceCommit: EVIDENCE_BASELINE,
        },
      ]
    : [];
  if (raw.EVENTS.some((e) => e.kind === 'obs' && e.sum))
    ruleVersions.push({
      id: WEEKLY_RULE_VERSION,
      provenance: 'demo_import_snapshot',
      sourceCommit: EVIDENCE_BASELINE,
    });
  const anchors = raw.DIMS.flatMap((d) =>
    raw.ANCHORS![d.axis].map((text, i) => ({
      id: stableId('anchor', d.id + ':' + (i + 1)),
      dimensionId: d.id,
      ruleVersionId: DEMO_RULE_VERSION,
      value: i + 1,
      text,
    })),
  );
  const snapshots = raw.EVENTS.map((e) => ({
    id: stableId('snapshot', e.id),
    recordId: e.id,
    sourceCommit: EVIDENCE_BASELINE,
    fieldPath: 'events[' + e.id + ']',
    provenance: 'demo_import_snapshot' as const,
    content: e,
  }));
  if (raw.EVENTS.length)
    for (const [file, source] of Object.entries(EVIDENCE_SOURCES)) {
      const originalId = stableId('original', file);
      records.originals.push({
        id: originalId,
        title: '原型演示快照 ' + file,
        kind: 'prototype_snapshot',
        displayNotice: BASELINE_NOTICE,
      });
      records.originalVersions.push({
        id: stableId('version', source.blob),
        originalId,
        version: 1,
        contentDigest: source.digest,
        sourceCommit: EVIDENCE_BASELINE,
        sourceBlob: source.blob,
        sourcePath: source.path,
      });
    }
  const byField = new Map<string, EvidenceRecords['fragments'][number]>();
  function fragment(field: string, excerpt: string, originalLocation?: string) {
    const existing = byField.get(field);
    if (existing) return existing;
    const file = raw.SNAPSHOT_FIELD_SOURCES[field] ?? 'data.js';
    const row: EvidenceRecords['fragments'][number] = {
      id: stableId('fragment', field),
      originalVersionId: stableId('version', EVIDENCE_SOURCES[file].blob),
      location: {
        kind: 'snapshot_field',
        fieldPath: field,
        ...(originalLocation === undefined ? {} : { originalLocation }),
      },
      excerpt,
    };
    byField.set(field, row);
    records.fragments.push(row);
    return row;
  }
  const linked = new Set<string>();
  function link(eventId: string, f: EvidenceRecords['fragments'][number]) {
    const key = eventId + ':' + f.id;
    if (!linked.has(key)) {
      records.eventSources.push({
        eventId,
        fragmentId: f.id,
        originalVersionId: f.originalVersionId,
      });
      linked.add(key);
    }
  }
  function anchor(dimension: string, score: number, recordId: string) {
    const found = anchors.filter(
      (a) => a.dimensionId === dimension && a.value === score,
    );
    if (found.length !== 1)
      throw new EvidenceMappingError(recordId, 'anchorId');
    return found[0].id;
  }
  for (const event of raw.EVENTS) {
    const base = 'events[' + event.id + ']';
    const srcs = event.srcs.map((s, i) =>
      fragment(
        base + '.srcs[' + i + ']',
        s.quote && /\S/u.test(s.quote) ? s.quote : JSON.stringify(s),
        s.loc,
      ),
    );
    if (new Set(event.people).size !== event.people.length)
      throw new EvidenceMappingError(event.id, 'duplicateParticipant');
    if (event.people.length !== 1)
      gaps.push({ recordId: event.id, missing: ['individualContribution'] });
    if (event.kind === 'hist') {
      if (!event.histType || !event.scale)
        throw new EvidenceMappingError(event.id, 'historicalScale');
      const f = fragment(base + '.scale', JSON.stringify(event.scale));
      const evaluationId = stableId('history', event.id);
      records.historicalEvaluations.push({
        id: evaluationId,
        sourceRecordId: event.id,
        evaluationNodeId: null,
        personId: event.people.length === 1 ? event.people[0] : null,
        recorderId: event.recorder,
        occurredOn: event.date,
        kind: event.histType,
        period: null,
        scale: event.scale,
        ruleVersionId: null,
        fragmentId: f.id,
        originalVersionId: f.originalVersionId,
        sourceCategory: 'prototype_baseline',
      });
      for (const personId of event.people)
        records.historicalParticipants.push({ evaluationId, personId });
      if (event.scores.length)
        throw new EvidenceMappingError(event.id, 'historicalDimensionScore');
      continue;
    }
    if (event.people.length !== 1) continue;
    if (!event.bg || event.act === undefined || event.res === undefined)
      throw new EvidenceMappingError(event.id, 'SBI');
    records.events.push({
      evaluationNodeId: null,
      id: event.id,
      personId: event.people[0],
      recorderId: event.recorder,
      projectId: event.project ?? null,
      occurredOn: event.date,
      title: event.title,
      situation: event.bg,
      behavior: event.act,
      impact: event.res,
      ruleVersionId: DEMO_RULE_VERSION,
      demo: true,
    });
    for (const [i, f] of srcs.entries()) {
      link(event.id, f);
      records.statements.push({
        id: stableId('statement', f.id),
        eventId: event.id,
        // A statement quoted from an original sheet cell is that cell's fact,
        // whoever recorded it; only a note with no original stays a management
        // observation (owner ruling on #248 after 6569099359).
        kind:
          event.srcs[i]!.type === 'sheet'
            ? 'original_fact'
            : 'management_observation',
        text: f.excerpt,
        authorId: event.recorder,
        modelVersion: null,
        uncertainty: null,
        fragmentId: f.id,
        originalVersionId: f.originalVersionId,
      });
    }
    if (event.sum) {
      const f = fragment(base + '.sum', event.sum);
      const evaluationId = stableId('weekly', event.id);
      records.historicalEvaluations.push({
        id: evaluationId,
        sourceRecordId: event.id,
        evaluationNodeId: null,
        personId: event.people[0],
        recorderId: event.recorder,
        occurredOn: event.date,
        kind: '训练营周评',
        period: event.week ?? null,
        scale: [['本周总结', event.sum]],
        ruleVersionId: WEEKLY_RULE_VERSION,
        fragmentId: f.id,
        originalVersionId: f.originalVersionId,
        sourceCategory: 'prototype_baseline',
      });
      records.historicalParticipants.push({
        evaluationId,
        personId: event.people[0],
      });
    }
    for (const [i, s] of event.scores.entries()) {
      const field = base + '.scores[' + i + ']';
      if (!raw.DIMS.some((d) => d.id === s.d))
        throw new EvidenceMappingError(field, 'dimensionId');
      if (s.p !== event.people[0])
        throw new EvidenceMappingError(field, 'personId');
      if (['unknown', 'not_demonstrated'].includes(s.st) && s.v != null)
        throw new EvidenceMappingError(field, 'unknownValue');
      let f: EvidenceRecords['fragments'][number];
      if (s.st === 'confirmed' || s.st === 'ai') {
        const quoted = /^引用「([\s\S]*)」$/u.exec(s.note ?? '');
        const quote = (quoted ? quoted[1] : (s.note ?? '')).replace(/…+$/u, '');
        const matches = event.srcs.flatMap((src, index) =>
          /\S/u.test(quote) && src.quote?.includes(quote) ? [srcs[index]] : [],
        );
        if (
          matches.length === 0 &&
          /\S/u.test(quote) &&
          event.act.includes(quote)
        )
          matches.push(fragment(base + '.act', event.act));
        if (matches.length !== 1)
          throw new EvidenceMappingError(field, 'uniqueQuote');
        f = matches[0];
      } else f = fragment(field, JSON.stringify(s));
      link(event.id, f);
      let suggestionId: string | null = null;
      const aiValue = s.st === 'ai' ? (s.v ?? s.ai) : s.ai;
      if (s.st === 'ai' || s.ai !== undefined) {
        if (aiValue == null) throw new EvidenceMappingError(field, 'aiValue');
        suggestionId = stableId('ai', field);
        records.aiSuggestions.push({
          id: suggestionId,
          eventId: event.id,
          dimensionId: s.d,
          ruleVersionId: DEMO_RULE_VERSION,
          sourceCategory: 'prototype_baseline',
          modelVersion: '原型基线',
          status: 'scored',
          value: aiValue,
          anchorId: anchor(s.d, aiValue, field),
          fragmentId: f.id,
          originalVersionId: f.originalVersionId,
          rationale: s.note || JSON.stringify(s),
        });
      }
      const confirm = (
        key: string,
        evaluatorId: string | null,
        value: number | null,
        reference: typeof f,
      ) => {
        link(event.id, reference);
        records.confirmations.push({
          id: stableId('confirmation', key),
          eventId: event.id,
          dimensionId: s.d,
          evaluatorId,
          sourceCategory: 'prototype_baseline',
          confirmedAt: null,
          ruleVersionId: DEMO_RULE_VERSION,
          status:
            value === null
              ? s.st === 'not_demonstrated'
                ? 'not_demonstrated'
                : 'unknown'
              : 'scored',
          value,
          anchorId: value === null ? null : anchor(s.d, value, key),
          fragmentId: reference.id,
          originalVersionId: reference.originalVersionId,
          revision: 1,
          active: true,
          modifiedBy: null,
          reason: null,
          previousId: null,
          previousRevision: null,
          suggestionId,
        });
      };
      if (s.st === 'confirmed') {
        if (s.v == null || !s.by)
          throw new EvidenceMappingError(field, 'evaluatorId/value');
        confirm(field, s.by, s.v, f);
      } else if (s.st === 'conflict') {
        if (!s.raters?.length) throw new EvidenceMappingError(field, 'raters');
        for (const [j, rater] of s.raters.entries()) {
          const key = field + '.raters[' + j + ']';
          confirm(key, rater.by, rater.v, fragment(key, JSON.stringify(rater)));
        }
      } else if (s.st !== 'ai') confirm(field, s.by ?? null, null, f);
      if (s.bigGap)
        records.scoreReviews.push({
          id: stableId('review', field),
          eventId: event.id,
          dimensionId: s.d,
          reason: 'score_gap',
          status: 'open',
        });
    }
  }
  const keys = new Set<string>();
  for (const row of records.confirmations) {
    const key = JSON.stringify([row.eventId, row.dimensionId, row.evaluatorId]);
    if (keys.has(key))
      throw new EvidenceMappingError(row.eventId, 'activeConfirmationKey');
    keys.add(key);
  }
  return { ...records, dimensions, ruleVersions, anchors, snapshots, gaps };
}
