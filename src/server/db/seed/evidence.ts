import { createHash } from 'node:crypto';
import { z } from 'zod';
const id = z.string().min(1);
const value = z.number().int().min(1).max(5);
const score = z.object({
  p: id,
  d: id,
  v: value.nullable().optional(),
  st: z.enum(['confirmed', 'conflict', 'ai', 'unknown', 'not_demonstrated']),
  by: id.nullable().optional(),
  ai: value.optional(),
  note: z.string().optional(),
  raters: z
    .array(z.object({ by: id, v: value, why: z.string().optional() }))
    .optional(),
});
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
          restricted: z.boolean().optional(),
          srcs: z.array(
            z.object({
              type: id,
              label: id,
              loc: z.string().optional(),
              quote: z.string().optional(),
            }),
          ),
          scores: z.array(score),
        })
        .passthrough(),
    )
    .default([]),
};
export const EVIDENCE_BASELINE = '2e51b50';
export const DEMO_RULE_VERSION = `demo-rules-${EVIDENCE_BASELINE}`;
export type ImportGap = { recordId: string; missing: string[] };
const stableId = (kind: string, key: string) =>
  `demo-${kind}-${createHash('sha256').update(`${EVIDENCE_BASELINE}:${key}`).digest('hex').slice(0, 24)}`;
/** Snapshot identity proves only the pinned prototype field, never the original observation document. */
export function mapEvidenceSeed(input: unknown) {
  const raw = z.object(evidenceSeedFields).parse(input);
  const gaps: ImportGap[] = [];
  const seen = new Set<string>();
  for (const row of [...raw.DIMS, ...raw.EVENTS]) {
    if (seen.has(row.id))
      throw new Error(`duplicate evidence identity: ${row.id}`);
    seen.add(row.id);
  }
  if (raw.DIMS.length && !raw.ANCHORS) throw new Error('missing anchors');
  const dimensions = raw.DIMS.map((d) => ({
    id: d.id,
    name: d.name,
    axis: d.axis,
    core: d.core,
  }));
  const ruleVersions = raw.DIMS.length
    ? [
        {
          id: DEMO_RULE_VERSION,
          provenance: 'demo_import_snapshot' as const,
          sourceCommit: EVIDENCE_BASELINE,
        },
      ]
    : [];
  const anchors = raw.DIMS.flatMap((d) =>
    raw.ANCHORS![d.axis].map((text, index) => ({
      id: stableId('anchor', `${d.id}:${index + 1}`),
      dimensionId: d.id,
      ruleVersionId: DEMO_RULE_VERSION,
      value: index + 1,
      text,
    })),
  );
  const snapshots = raw.EVENTS.map((e) => ({
    id: stableId('snapshot', e.id),
    recordId: e.id,
    sourceCommit: EVIDENCE_BASELINE,
    fieldPath: `EVENTS[${JSON.stringify(e.id)}]`,
    provenance: 'demo_import_snapshot' as const,
    content: e,
  }));
  const events = [] as {
    id: string;
    personId: string;
    recorderId: string;
    projectId: string | null;
    occurredOn: string;
    title: string;
    situation: string;
    behavior: string;
    impact: string;
    ruleVersionId: string;
    demo: boolean;
  }[];
  for (const event of raw.EVENTS) {
    if (event.people.length !== 1)
      gaps.push({ recordId: event.id, missing: ['individualContribution'] });
    else if (event.kind === 'obs') {
      if (
        !event.bg ||
        !event.act ||
        event.res === undefined ||
        !ruleVersions.length
      )
        gaps.push({ recordId: event.id, missing: ['SBI', 'ruleVersionId'] });
      else
        events.push({
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
    }
    gaps.push({
      recordId: event.id,
      missing: ['originalVersionId', 'location'],
    });
    for (const [index, s] of event.scores.entries()) {
      if (!dimensions.some((d) => d.id === s.d))
        throw new Error(`unresolved dimension: ${event.id}/scores/${index}`);
      if (!event.people.includes(s.p))
        throw new Error(
          `unresolved score subject: ${event.id}/scores/${index}`,
        );
      if (['unknown', 'not_demonstrated'].includes(s.st) && s.v != null)
        throw new Error(`unknown score has value: ${event.id}/scores/${index}`);
      const key = `${event.id}/scores/${index}`;
      const missing = [
        'fragmentId',
        'originalVersionId',
        'location',
        'anchorId',
        'ruleVersionId',
      ];
      if (s.st === 'conflict') {
        for (const [i] of (s.raters ?? []).entries())
          gaps.push({ recordId: `${key}/raters/${i}`, missing: [...missing] });
        if (!s.raters?.length)
          gaps.push({ recordId: key, missing: [...missing, 'evaluatorId'] });
      } else if (s.st !== 'ai')
        gaps.push({
          recordId: key,
          missing: [...missing, ...(s.by ? [] : ['evaluatorId'])],
        });
      if (s.st === 'ai' || s.ai !== undefined)
        gaps.push({
          recordId: `${key}/ai`,
          missing: [...missing, 'modelVersion'],
        });
    }
  }
  return {
    dimensions,
    ruleVersions,
    anchors,
    snapshots,
    events,
    gaps,
    fragments: [],
    confirmations: [],
    aiSuggestions: [],
  };
}
