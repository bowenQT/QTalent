import 'server-only';
import {
  peopleInputSchema,
  peopleListSchema,
  quickViewSchema,
  type PeopleList,
  type QuickView,
} from '../../contracts/people';
import type { TalentSource } from '../authz/talent';
import { ForbiddenError } from '../usecases/project-context';
import { type PersonData, talentSources } from './person-data';
import { byCodePoint, byPinyin, identityOf } from './person-identity';
import {
  collectEvidence,
  orderedDimensions,
  type Evidence,
} from './person-evidence';
import {
  personRole,
  profileGate,
  projectsOf,
  referenceOf,
} from './person-projection';
import { loadCurrentPersonData } from './person-session';

/** Window-free projection of the effective confirmed scores: only the number of
 * distinct events and the anchor text of the highest level are shown, never a
 * value, mean, percentage or rank. Dimensions follow the catalogue order.
 */
function capabilityLines(data: PersonData, evidence: Evidence) {
  const dimensions = orderedDimensions(data);
  const lines = dimensions.flatMap((dimension) => {
    const rows = evidence.effective.filter(
      (row) => row.dimension.id === dimension.id,
    );
    if (!rows.length) return [];
    const top = [...rows].sort(
      (a, b) =>
        b.score.value - a.score.value ||
        byCodePoint(a.score.scoreId, b.score.scoreId),
    )[0];
    return [
      {
        dimensionId: dimension.id,
        dimensionLabel: dimension.name,
        eventCount: new Set(rows.map((row) => row.event.id)).size,
        topAnchor: top.score.anchor,
      },
    ];
  });
  return lines.length
    ? {
        status: 'ready' as const,
        data: { lines, uncoveredCount: dimensions.length - lines.length },
      }
    : {
        status: 'insufficient_evidence' as const,
        reason: '暂无可用的已确认维度分',
      };
}
export async function quickViewFromData(
  data: PersonData,
  id: string,
  sources: TalentSource[] = talentSources(data),
): Promise<QuickView | null> {
  const gate = profileGate(data, id);
  if (!gate) return null;
  const evidence = await collectEvidence(data, id, sources);
  const projects = projectsOf(data, id);
  const facts = evidence.keyEvents.slice(0, 3).map((event) => ({
    eventId: event.id,
    occurredOn: event.occurredOn,
    title: event.title,
    ...(event.projectName === undefined
      ? {}
      : { projectName: event.projectName }),
    recorderName: event.recorderName,
    sources: event.sources,
  }));
  const shared = {
    role: gate.role,
    person: identityOf(data, gate.row),
    // Counts include only projects the caller may read.
    projectLoad: {
      current: new Set(
        projects.filter((row) => row.to === null).map((row) => row.id),
      ).size,
      ever: new Set(projects.map((row) => row.id)).size,
    },
    recentFacts: facts.length
      ? { status: 'ready' as const, data: facts }
      : { status: 'empty' as const },
    capabilityLines: capabilityLines(data, evidence),
  };
  if (gate.role === 'mentor') return quickViewSchema.parse(shared);
  const reference = referenceOf(
    data,
    gate.allowed('quadrant'),
    evidence.effective,
  );
  // The list shape carries the quadrant only, without the profile's flag.
  return quickViewSchema.parse({
    ...shared,
    referencePosition:
      reference.status === 'ready'
        ? {
            status: 'ready',
            data: { kind: 'reference', quadrant: reference.data.quadrant },
          }
        : reference,
  });
}
export async function peopleFromData(
  data: PersonData,
  input: unknown = {},
): Promise<PeopleList> {
  const filter = peopleInputSchema.parse(input);
  const role = personRole(data);
  if (!role) throw new ForbiddenError();
  const sources = talentSources(data);
  const people: QuickView[] = [];
  for (const row of data.directory.people) {
    if (filter.teamId && row.organizationId !== filter.teamId) continue;
    if (
      filter.query &&
      !row.name.toLocaleLowerCase().includes(filter.query.toLocaleLowerCase())
    )
      continue;
    const view = await quickViewFromData(data, row.id, sources);
    if (view) people.push(view);
  }
  // Authorized first, sorted in code: team and name by pinyin, id by code point.
  // No score, calibration or reference position takes part.
  people.sort(
    (a, b) =>
      byPinyin(a.person.teamName, b.person.teamName) ||
      byPinyin(a.person.name, b.person.name) ||
      byCodePoint(a.person.id, b.person.id),
  );
  return peopleListSchema.parse({ role, people, total: people.length });
}
export async function listPeopleForCurrentUser(input: unknown = {}) {
  return peopleFromData(await loadCurrentPersonData(), input);
}
