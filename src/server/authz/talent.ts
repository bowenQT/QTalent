import type { MaterialSourceLocation } from '../../contracts/sources';
import {
  activeGrants,
  isCurrent,
  type AuthzContext,
  type Grant,
} from './index';
import {
  canReadNodeTalent,
  type EvaluationAuthzContext,
} from './evaluation-node';

export type TalentAuthorizationContext = AuthzContext &
  Partial<
    Pick<
      EvaluationAuthzContext,
      'evaluationNodes' | 'evaluationNodeSubjects' | 'evaluationRelations'
    >
  >;
export type TalentKind =
  | 'person'
  | 'evaluation'
  | 'restricted-evaluation'
  | 'confirmed-score'
  | 'quadrant'
  | 'management-observation'
  | 'change'
  | 'performance'
  | 'ai-inference';
export type TalentPurpose =
  | 'people-list'
  | 'person-preview'
  | 'person-profile'
  | 'workbench'
  | 'source-read'
  | 'model-input';
export interface TalentSubject {
  personId: string;
  /** The period in which THIS content arose, not the person's current period. */
  cohortId: string | null;
  /** Server-resolved node of THIS content; absence never means every node. */
  evaluationNodeId?: string | null;
}
export interface TalentResource extends TalentSubject {
  kind: TalentKind;
}
export interface TalentSourceReference {
  fragmentId: string;
  originalVersionId: string;
}
export type TalentSourceLocation =
  | MaterialSourceLocation
  | { kind: 'document'; page?: number; paragraph: string }
  | { kind: 'spreadsheet'; sheet: string; cell: string }
  | { kind: 'recording'; startMs: number; endMs: number }
  | { kind: 'snapshot_field'; fieldPath: string; originalLocation?: string };
export interface TalentSource extends TalentSourceReference {
  /** Complete server-resolved subjects, including every event sharing a fragment. */
  subjects: TalentSubject[];
  kind: TalentKind;
  /** Additional content restrictions for mixed fragments; never just display labels. */
  requiredKinds?: TalentKind[];
  excerpt: string;
  location: TalentSourceLocation;
}
export interface TalentField {
  name: string;
  kind: TalentKind;
  /** Atomic values prevent forwarding unclassified nested raw records. */
  value: string | number | boolean | null;
  subjects: TalentSubject[];
  sources: TalentSourceReference[];
}
export interface TalentRecord {
  id: string;
  subject: TalentSubject;
  kind: TalentKind;
  fields: TalentField[];
}
export interface VisibleTalentSource extends TalentSourceReference {
  location: TalentSourceLocation;
  excerpt: string;
}
export interface VisibleTalentRecord {
  id: string;
  personId: string;
  kind: TalentKind;
  fields: Record<string, TalentField['value']>;
  /** Preserve content provenance without re-reading unfiltered records. */
  fieldKinds: Record<string, TalentKind>;
  sources: VisibleTalentSource[];
}
/** Trusted server adapter, not a client list or a cached authorization decision.
 * Reload current account, grants, relationships and business clock on EVERY call.
 * Resolve records/provenance from authoritative storage, not request-supplied roles.
 */
export type LoadTalentSnapshot = () => Promise<{
  context: TalentAuthorizationContext;
  records: TalentRecord[];
  sources: TalentSource[];
}>;

const purposes: readonly string[] = [
  'people-list',
  'person-preview',
  'person-profile',
  'workbench',
  'source-read',
  'model-input',
];
const mentorKinds: readonly TalentKind[] = [
  'person',
  'evaluation',
  'confirmed-score',
];
// Restricted evaluations remain available to authorized HR/management model
// input. Legacy cohort mentoring does not grant their review-node access; the
// trusted same-node relation adapter is delivered with BOW-899.
const directKinds: readonly TalentKind[] = [
  ...mentorKinds,
  'restricted-evaluation',
  'quadrant',
  'management-observation',
  'change',
  'performance',
];
function grantAllows(
  ctx: TalentAuthorizationContext,
  grant: Grant,
  resource: TalentResource,
): boolean {
  if (grant.role === 'manager') return true;
  if (grant.role === 'hr') {
    return ctx.enrollments.some(
      (entry) =>
        entry.personId === resource.personId &&
        entry.cohortId === grant.cohortId &&
        isCurrent(entry, ctx.now) &&
        (entry.confirmed || resource.cohortId === entry.cohortId),
    );
  }
  if (grant.role !== 'mentor') return false;
  return (
    mentorKinds.includes(resource.kind) &&
    ctx.assignments.some(
      (entry) =>
        entry.cohortId === grant.cohortId &&
        entry.personId === ctx.account.personId &&
        entry.studentId === resource.personId &&
        isCurrent(entry, ctx.now),
    )
  );
}
/** Direct content authorization. AI inference needs source-aware projection below.
 * This does NOT grant project-create access and never consumes client-visible IDs.
 */
export function canReadTalent(
  ctx: TalentAuthorizationContext,
  resource: TalentResource,
  purpose: string,
): boolean {
  if (
    !purposes.includes(purpose) ||
    !directKinds.includes(resource.kind) ||
    (purpose === 'model-input' && resource.kind === 'performance') ||
    !ctx.people.some(
      (person) => person.id === resource.personId && !person.noReview,
    )
  )
    return false;
  const hasNodeFacts =
    ctx.evaluationNodes !== undefined ||
    ctx.evaluationNodeSubjects !== undefined ||
    ctx.evaluationRelations !== undefined;
  if (hasNodeFacts) {
    if (!completeNodeContext(ctx)) return false;
    if (resource.evaluationNodeId != null) {
      return canReadNodeTalent(
        ctx,
        {
          evaluationNodeId: resource.evaluationNodeId,
          personId: resource.personId,
          kind: resource.kind,
        },
        purpose,
      );
    }
    // Existing manager/HR scope remains valid for unmapped legacy facts.
    // Evaluators may see a directory identity through a current node, but
    // never node-less evidence, even with an old mentor assignment.
    if (
      activeGrants(ctx).some(
        (grant) => grant.role !== 'mentor' && grantAllows(ctx, grant, resource),
      )
    )
      return true;
    return (
      resource.kind === 'person' &&
      ctx.evaluationNodes.some((node) =>
        canReadNodeTalent(
          ctx,
          {
            evaluationNodeId: node.id,
            personId: resource.personId,
            kind: 'person',
          },
          purpose,
        ),
      )
    );
  }
  // P0 remains in use until X1 installs all node facts in the shared loader.
  // BOW-899 cannot be complete until every reader supplies that fresh context.
  return activeGrants(ctx).some((grant) => grantAllows(ctx, grant, resource));
}
function completeNodeContext(
  ctx: TalentAuthorizationContext,
): ctx is EvaluationAuthzContext {
  return (
    ctx.evaluationNodes !== undefined &&
    ctx.evaluationNodeSubjects !== undefined &&
    ctx.evaluationRelations !== undefined
  );
}
function readableSource(
  ctx: TalentAuthorizationContext,
  source: TalentSource,
  purpose: TalentPurpose,
): boolean {
  return (
    source.subjects.length > 0 &&
    source.subjects.every((subject) =>
      [source.kind, ...(source.requiredKinds ?? [])].every((kind) =>
        canReadTalent(ctx, { ...subject, kind }, purpose),
      ),
    )
  );
}
function findSource(
  sources: TalentSource[],
  reference: TalentSourceReference,
): TalentSource | undefined {
  return sources.find(
    (source) =>
      source.fragmentId === reference.fragmentId &&
      source.originalVersionId === reference.originalVersionId,
  );
}
function visibleSource(source: TalentSource): VisibleTalentSource {
  // Reconstruct, rather than forwarding a raw original or relation metadata.
  const location = source.location;
  if (location.kind === 'snapshot_field')
    return {
      fragmentId: source.fragmentId,
      originalVersionId: source.originalVersionId,
      excerpt: source.excerpt,
      location: {
        kind: 'snapshot_field',
        fieldPath: location.fieldPath,
        ...(location.originalLocation === undefined
          ? {}
          : { originalLocation: location.originalLocation }),
      },
    };
  let safeLocation: TalentSourceLocation;
  switch (location.kind) {
    case 'document':
      safeLocation = {
        kind: 'document',
        paragraph: location.paragraph,
        ...(location.page === undefined ? {} : { page: location.page }),
      };
      break;
    case 'spreadsheet':
      safeLocation = {
        kind: 'spreadsheet',
        sheet: location.sheet,
        cell: location.cell,
      };
      break;
    case 'recording':
    case 'video':
      safeLocation = {
        kind: location.kind,
        startMs: location.startMs,
        endMs: location.endMs,
      };
      break;
    case 'pdf':
      safeLocation = {
        kind: 'pdf',
        page: location.page,
        textRange: {
          start: location.textRange.start,
          end: location.textRange.end,
        },
      };
      break;
    case 'presentation':
      safeLocation = { kind: 'presentation', slide: location.slide };
      break;
    case 'image':
      safeLocation = {
        kind: 'image',
        region: {
          left: location.region.left,
          top: location.region.top,
          right: location.region.right,
          bottom: location.region.bottom,
        },
      };
      break;
    case 'code':
      safeLocation = {
        kind: 'code',
        repository: location.repository,
        commit: location.commit,
        path: location.path,
        startLine: location.startLine,
        endLine: location.endLine,
      };
      break;
  }
  return {
    fragmentId: source.fragmentId,
    originalVersionId: source.originalVersionId,
    location: safeLocation,
    excerpt: source.excerpt,
  };
}
/** Each field is an atomic server-classified unit. Include every referenced subject
 * and every contributing source. A forbidden/missing source suppresses its whole
 * derived field, not just the citation. No denied-field names/counts are returned.
 */
export function projectTalentRecord(
  ctx: TalentAuthorizationContext,
  record: TalentRecord,
  sources: TalentSource[],
  purpose: TalentPurpose,
): VisibleTalentRecord | null {
  const recordKind = record.kind === 'ai-inference' ? 'person' : record.kind;
  if (!canReadTalent(ctx, { ...record.subject, kind: recordKind }, purpose))
    return null;
  const entries: [string, TalentField['value']][] = [];
  const fieldKinds: [string, TalentKind][] = [];
  const references = new Map<string, VisibleTalentSource>();
  for (const field of record.fields) {
    const inference =
      record.kind === 'ai-inference' || field.kind === 'ai-inference';
    if (inference && field.sources.length === 0) continue;
    const kind = field.kind === 'ai-inference' ? 'person' : field.kind;
    if (
      ![record.subject, ...field.subjects].every((subject) =>
        canReadTalent(ctx, { ...subject, kind }, purpose),
      )
    )
      continue;
    const resolved = field.sources.map((reference) =>
      findSource(sources, reference),
    );
    if (
      !resolved.every(
        (source): source is TalentSource =>
          source !== undefined && readableSource(ctx, source, purpose),
      )
    )
      continue;
    entries.push([field.name, field.value]);
    fieldKinds.push([
      field.name,
      record.kind === 'ai-inference' ? 'ai-inference' : field.kind,
    ]);
    for (const source of resolved) {
      references.set(
        JSON.stringify([source.fragmentId, source.originalVersionId]),
        visibleSource(source),
      );
    }
  }
  if (entries.length === 0) return null;
  return {
    id: record.id,
    personId: record.subject.personId,
    kind: record.kind,
    fields: Object.fromEntries(entries),
    fieldKinds: Object.fromEntries(fieldKinds),
    sources: [...references.values()],
  };
}
function projectSnapshot(
  snapshot: Awaited<ReturnType<LoadTalentSnapshot>>,
  purpose: TalentPurpose,
): VisibleTalentRecord[] {
  return snapshot.records.flatMap((record) => {
    const visible = projectTalentRecord(
      snapshot.context,
      record,
      snapshot.sources,
      purpose,
    );
    return visible ? [visible] : [];
  });
}
export async function readTalentCollection(
  load: LoadTalentSnapshot,
  purpose: TalentPurpose,
): Promise<{ items: VisibleTalentRecord[]; total: number }> {
  const items = projectSnapshot(await load(), purpose);
  return { items, total: items.length };
}
/** Absent and out-of-scope IDs have the same outward result. The query/usecase
 * maps null to the foundation not_found contract and owns sensitive-read audit.
 */
export async function readTalentRecord(
  load: LoadTalentSnapshot,
  id: string,
  purpose: TalentPurpose,
): Promise<VisibleTalentRecord | null> {
  const snapshot = await load();
  const record = snapshot.records.find((entry) => entry.id === id);
  return record
    ? projectTalentRecord(snapshot.context, record, snapshot.sources, purpose)
    : null;
}
export async function readTalentSource(
  load: LoadTalentSnapshot,
  reference: TalentSourceReference,
): Promise<VisibleTalentSource | null> {
  const snapshot = await load();
  const source = findSource(snapshot.sources, reference);
  return source && readableSource(snapshot.context, source, 'source-read')
    ? visibleSource(source)
    : null;
}
/** The only model-input construction entry point: no prefiltered client list,
 * previous-page permission token, or raw-record escape hatch. This performs no
 * model call. HR performance/personnel material is never model input.
 */
export async function buildAuthorizedModelInput(
  load: LoadTalentSnapshot,
): Promise<{ items: VisibleTalentRecord[] }> {
  return { items: projectSnapshot(await load(), 'model-input') };
}
