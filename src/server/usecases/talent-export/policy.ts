import { activeGrants, isCurrent } from '../../authz';
import {
  canReadTalent,
  projectTalentRecord,
  readTalentSource,
} from '../../authz/talent';
import {
  eventSubject,
  sourceKey,
  talentSources,
} from '../talent-source-projection';
import {
  TalentExportError,
  type ExportSnapshot,
  type ExportProjection,
  type ExportRequest,
  type ExportScope,
  type ExportSource,
  type ExportRow,
  type ConfirmedPersonExport,
} from './types';

function fail(): never {
  throw new TalentExportError('unavailable');
}
function exportContext(data: ExportSnapshot) {
  const c = data.context;
  const grants = activeGrants(c).filter(
    (g) => g.role === 'manager' || g.role === 'hr',
  );
  if (c.account.isSystemAdmin || grants.length === 0)
    throw new TalentExportError('forbidden');
  if (
    ![c.evaluationNodes, c.evaluationNodeSubjects, c.evaluationRelations].every(
      Array.isArray,
    ) ||
    !Number.isFinite(Date.parse(c.now))
  )
    fail();
  // Export never inherits an additional mentor/evaluator scope of a mixed account.
  return { ...c, grants, assignments: [], evaluationRelations: [] };
}
function scopesFor(
  data: ExportSnapshot,
  context: ReturnType<typeof exportContext>,
) {
  const manager = context.grants.some((g) => g.role === 'manager');
  const eligible = data.directory.people.filter((p) =>
    canReadTalent(
      context,
      { personId: p.id, cohortId: null, kind: 'person' },
      'workbench',
    ),
  );
  const result: {
    id: string;
    label: string;
    people: Set<string>;
    accepts: (subject: ReturnType<typeof eventSubject>) => boolean;
  }[] = [
    {
      id: 'all',
      label: manager ? '当前可见的全部人员' : '当前负责的人员',
      people: new Set(eligible.map((p) => p.id)),
      accepts: () => true,
    },
  ];
  for (const cohort of [...data.cohorts].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    const people = new Set(
      eligible
        .filter((p) =>
          context.enrollments.some(
            (e) =>
              e.personId === p.id &&
              e.cohortId === cohort.id &&
              isCurrent(e, context.now),
          ),
        )
        .map((p) => p.id),
    );
    if (
      manager ||
      people.size > 0 ||
      context.grants.some((g) => g.role === 'hr' && g.cohortId === cohort.id)
    )
      result.push({
        id: 'cohort:' + cohort.id,
        label: cohort.name,
        people,
        accepts: (subject) => subject.cohortId === cohort.id,
      });
  }
  for (const node of [...data.nodes].sort((a, b) => a.id.localeCompare(b.id))) {
    const people = new Set(
      context.evaluationNodeSubjects
        .filter(
          (s) =>
            s.evaluationNodeId === node.id &&
            canReadTalent(
              context,
              { ...s, cohortId: node.cohortId, kind: 'person' },
              'workbench',
            ),
        )
        .map((s) => s.personId),
    );
    if (
      manager ||
      people.size > 0 ||
      (node.cohortId !== null &&
        context.grants.some(
          (g) => g.role === 'hr' && g.cohortId === node.cohortId,
        ))
    )
      result.push({
        id: 'node:' + node.id,
        label: node.name,
        people,
        accepts: (subject) => subject.evaluationNodeId === node.id,
      });
  }
  return result;
}
/** Calendar months, same inclusive business-date lower bound as the prototype. */
export function exportFromDay(asOf: string, range: ExportRequest['range']) {
  if (range === 'all') return null;
  const [y, m, d] = asOf.split('-').map(Number);
  const month = new Date(
    Date.UTC(y!, m! - 1 - (range === 'last12Months' ? 12 : 3), 1),
  );
  const last = new Date(
    Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0),
  ).getUTCDate();
  month.setUTCDate(Math.min(d!, last));
  return month.toISOString().slice(0, 10);
}
function inRange(date: string, asOf: string, from: string | null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)))
    fail();
  return date <= asOf && (from === null || date >= from);
}
function timestamp(value: Date | null): string | null {
  if (value === null) return null;
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail();
  return value.toISOString();
}
async function catalog(data: ExportSnapshot) {
  const context = exportContext(data);
  const actor = data.directory.people.find(
    (p) => p.id === context.account.personId,
  );
  if (!actor?.name.trim()) fail();
  const sources = talentSources({ ...data, context });
  const load = async () => ({ context, records: [], sources });
  const visible = new Map<
    string,
    {
      event: ExportSnapshot['events'][number];
      sources: ExportSource[];
      person: ExportSnapshot['directory']['people'][number];
      organization: string;
    }
  >();
  for (const event of data.events) {
    const subject = eventSubject(data, event);
    if (
      !canReadTalent(
        context,
        { ...subject, kind: 'confirmed-score' },
        'workbench',
      )
    )
      continue;
    if (event.withdrawnAt === undefined) fail();
    if (timestamp(event.withdrawnAt) !== null) continue;
    const references = data.eventSources
      .filter((s) => s.eventId === event.id)
      .sort((a, b) => sourceKey(a).localeCompare(sourceKey(b)));
    if (!references.length) continue;
    const subjects = data.participants
      .filter((p) => p.eventId === event.id)
      .map((p) => ({ ...subject, personId: p.personId }));
    const projected = projectTalentRecord(
      context,
      {
        id: event.id,
        subject,
        kind: 'evaluation',
        fields: (['title', 'situation', 'behavior', 'impact'] as const).map(
          (name) => ({
            name,
            value: event[name],
            kind: 'evaluation',
            subjects,
            sources: references,
          }),
        ),
      },
      sources,
      'workbench',
    );
    if (!projected || Object.keys(projected.fields).length !== 4) continue;
    const resolved: ExportSource[] = [];
    let complete = true;
    for (const reference of references) {
      const source = await readTalentSource(load, reference);
      const version = data.versions.find(
        (v) => v.id === reference.originalVersionId,
      );
      const original = data.originals.find((o) => o.id === version?.originalId);
      if (!source) {
        complete = false;
        break;
      }
      if (
        !version ||
        !original ||
        !original.title.trim() ||
        !['original', 'prototype_snapshot'].includes(original.kind)
      )
        fail();
      if (
        original.kind === 'prototype_snapshot' &&
        (!event.demo ||
          !sources
            .find((s) => sourceKey(s) === sourceKey(reference))!
            .subjects.every((s) =>
              data.directory.people.some((p) => p.id === s.personId && p.demo),
            ))
      ) {
        complete = false;
        break;
      }
      resolved.push({ ...source, originalTitle: original.title });
    }
    const person = data.directory.people.find((p) => p.id === event.personId);
    const organization = data.directory.organizations.find(
      (o) => o.id === person?.organizationId,
    );
    if (!complete || !person?.name.trim() || !organization?.name.trim())
      continue;
    visible.set(event.id, {
      event,
      sources: resolved,
      person,
      organization: organization.name,
    });
  }
  return {
    context,
    actorName: actor.name,
    scopes: scopesFor(data, context),
    visible,
  };
}
function isBlocked(
  data: ExportSnapshot,
  confirmation: ExportSnapshot['confirmations'][number],
) {
  for (const review of data.reviews.filter(
    (r) =>
      r.eventId === confirmation.eventId &&
      r.dimensionId === confirmation.dimensionId,
  )) {
    if (
      !['open', 'resolved'].includes(review.status) ||
      review.withdrawnAt === undefined ||
      (review.confirmationId !== null &&
        typeof review.confirmationId !== 'string') ||
      (review.counterpartConfirmationId !== null &&
        typeof review.counterpartConfirmationId !== 'string')
    )
      fail();
    if (review.status !== 'open' || timestamp(review.withdrawnAt) !== null)
      continue;
    if (
      review.confirmationId === null &&
      review.counterpartConfirmationId === null
    )
      return true;
    if (
      [review.confirmationId, review.counterpartConfirmationId].includes(
        confirmation.id,
      )
    )
      return true;
  }
  return false;
}
function project(
  data: ExportSnapshot,
  prepared: Awaited<ReturnType<typeof catalog>>,
  request: ExportRequest,
): ExportProjection {
  const scope = prepared.scopes.find((s) => s.id === request.scopeId);
  if (!scope) throw new TalentExportError('forbidden');
  const asOf = data.context.now.slice(0, 10),
    from = exportFromDay(asOf, request.range);
  const rows: ExportRow[] = [];
  let skipped = 0;
  const pending = new Set<string>();
  const events = new Map(
    [...prepared.visible].filter(
      ([, v]) =>
        scope.accepts(eventSubject(data, v.event)) &&
        inRange(v.event.occurredOn, asOf, from),
    ),
  );
  for (const c of data.confirmations) {
    const entry = events.get(c.eventId);
    if (!entry || !c.active || c.status !== 'scored') continue;
    const { event, sources, person, organization } = entry;
    if (
      c.ruleVersionId !== event.ruleVersionId ||
      !Number.isInteger(c.value) ||
      c.value! < 1 ||
      c.value! > 5
    )
      fail();
    const evaluator = data.directory.people.find((p) => p.id === c.evaluatorId);
    const dimension = data.dimensions.find((d) => d.id === c.dimensionId);
    const anchor = data.anchors.find(
      (a) =>
        a.id === c.anchorId &&
        a.dimensionId === c.dimensionId &&
        a.ruleVersionId === c.ruleVersionId &&
        a.value === c.value,
    );
    const rule = data.ruleVersions.find((v) => v.id === c.ruleVersionId);
    if (
      !evaluator?.name.trim() ||
      !dimension?.name.trim() ||
      !anchor?.text.trim() ||
      !rule
    )
      fail();
    const exactSource =
      sources.find((s) => sourceKey(s) === sourceKey(c)) ?? null;
    const checkSources = exactSource ? [exactSource] : sources;
    const categories = checkSources.map((s) =>
      data.originals.find(
        (o) =>
          o.id ===
          data.versions.find((v) => v.id === s.originalVersionId)?.originalId,
      )?.kind === 'prototype_snapshot'
        ? 'prototype_baseline'
        : 'original',
    );
    if (
      !categories.length ||
      !categories.every((category) => category === c.sourceCategory)
    )
      fail();
    if (c.sourceCategory === 'prototype_baseline') {
      if (
        !event.demo ||
        !person.demo ||
        rule.provenance !== 'demo_import_snapshot' ||
        c.confirmedAt !== null
      )
        fail();
    } else if (c.sourceCategory !== 'original') fail();
    const confirmedAt = timestamp(c.confirmedAt);
    const key = JSON.stringify([c.eventId, c.dimensionId]);
    if (c.sourceCategory === 'original' && confirmedAt === null) {
      pending.add(key);
      continue;
    }
    if (isBlocked(data, c)) {
      skipped++;
      continue;
    }
    rows.push({
      confirmationId: c.id,
      personId: person.id,
      personName: person.name,
      organization,
      eventId: event.id,
      eventDate: event.occurredOn,
      title: event.title,
      situation: event.situation,
      behavior: event.behavior,
      impact: event.impact,
      dimensionId: dimension.id,
      dimension: dimension.name,
      value: c.value!,
      anchor: anchor.text,
      quote: sources.map((s) => s.excerpt).join('\n'),
      evaluatorId: evaluator.id,
      evaluatorName: evaluator.name,
      ruleVersionId: c.ruleVersionId,
      confirmedAt,
      sourceCategory: c.sourceCategory,
      demo: event.demo && person.demo,
      sources,
      exactSource,
    });
  }
  for (const suggestion of data.suggestions) {
    const entry = events.get(suggestion.eventId);
    if (
      !entry ||
      suggestion.status !== 'scored' ||
      !entry.sources.some((s) => sourceKey(s) === sourceKey(suggestion))
    )
      continue;
    if (
      !data.confirmations.some(
        (c) =>
          c.active &&
          c.eventId === suggestion.eventId &&
          c.dimensionId === suggestion.dimensionId &&
          (c.sourceCategory === 'prototype_baseline' || c.confirmedAt !== null),
      )
    )
      pending.add(JSON.stringify([suggestion.eventId, suggestion.dimensionId]));
  }
  skipped += pending.size;
  rows.sort(
    (a, b) =>
      b.eventDate.localeCompare(a.eventDate) ||
      a.eventId.localeCompare(b.eventId) ||
      a.dimensionId.localeCompare(b.dimensionId) ||
      a.evaluatorId.localeCompare(b.evaluatorId) ||
      a.confirmationId.localeCompare(b.confirmationId),
  );
  return {
    scopeId: scope.id,
    scopeLabel: scope.label,
    range: request.range,
    asOf,
    actorName: prepared.actorName,
    people: new Set(rows.map((r) => r.personId)).size,
    rows: rows.length,
    skipped,
    data: rows,
  };
}
export async function projectTalentExport(
  data: ExportSnapshot,
  request: ExportRequest,
) {
  return project(data, await catalog(data), request);
}
export async function viewTalentExport(
  data: ExportSnapshot,
): Promise<{ scopes: ExportScope[] }> {
  const prepared = await catalog(data);
  return {
    scopes: prepared.scopes.map((scope) => {
      const preview = (range: ExportRequest['range']) => {
        const { people, rows, skipped } = project(data, prepared, {
          scopeId: scope.id,
          range,
        });
        return { people, rows, skipped };
      };
      return {
        id: scope.id,
        label: scope.label,
        people: scope.people.size,
        previews: {
          all: preview('all'),
          last12Months: preview('last12Months'),
          last3Months: preview('last3Months'),
        },
      };
    }),
  };
}

/** The selected subject is re-authorized on every read. It is not an extra
 * batch scope and cannot grant access to a person outside the current role. */
export async function projectPersonExport(
  data: ExportSnapshot,
  personId: string,
): Promise<ConfirmedPersonExport> {
  const prepared = await catalog(data);
  const person = data.directory.people.find((p) => p.id === personId);
  if (!person || !prepared.scopes[0]!.people.has(personId))
    throw new TalentExportError('forbidden');
  const organization = data.directory.organizations.find(
    (o) => o.id === person.organizationId,
  );
  if (!person.name.trim() || !organization?.name.trim()) fail();
  const scopeId = 'person:' + personId;
  prepared.scopes.push({
    id: scopeId,
    label: person.name,
    people: new Set([personId]),
    accepts: (subject) => subject.personId === personId,
  });
  return {
    person: {
      id: person.id,
      name: person.name,
      organization: organization.name,
      demo: person.demo,
    },
    projection: project(data, prepared, { scopeId, range: 'all' }),
  };
}
