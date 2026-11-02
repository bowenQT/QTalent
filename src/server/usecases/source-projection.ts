import { readTalentSource, type TalentSource } from '../authz/talent';
import {
  sourceSchema,
  type Source,
  type SourceReadResult,
} from '../../contracts/sources';
import {
  completeTalentSources,
  sourceKey,
  type TalentSourceProjectionData,
} from './talent-source-projection';

// No 'server-only': the matching worker reads sources through this module too.
/** The evidence snapshot plus the directory: what a source read needs. */
export type SourceData = TalentSourceProjectionData & {
  directory: { people: readonly { id: string; demo: boolean }[] };
};

export async function sourceFromData(
  data: SourceData,
  reference: { fragmentId: string; originalVersionId: string },
  // Callers that read many sources pass the already resolved relations.
  resolved: TalentSource[] = completeTalentSources(data),
): Promise<SourceReadResult> {
  const visible = await readTalentSource(
    async () => ({
      context: data.context,
      records: [],
      sources: resolved,
    }),
    reference,
  );
  const missing = {
    status: 'not_found',
    message: '来源不存在或不可见',
  } as const;
  if (!visible) return missing;
  const version = data.versions.find(
    (row) => row.id === reference.originalVersionId,
  );
  const original = data.originals.find((row) => row.id === version?.originalId);
  if (!original) return missing;
  const links = data.eventSources.filter(
    (row) => sourceKey(row) === sourceKey(reference),
  );
  const linkedEvents = data.events.filter((row) =>
    links.some((link) => link.eventId === row.id),
  );
  // The fragment itself has no recorder (BOW-834): null means unknown, and the
  // recorder of a linked event is never used in its place.
  const detail = {
    ...visible,
    originalTitle: original.title,
    recordedByName: null,
  };
  const source =
    original.kind === 'prototype_snapshot'
      ? {
          ...detail,
          sourceType: 'prototype_snapshot',
          sourceCategory: 'prototype_baseline',
          demo: true,
          displayNotice: original.displayNotice,
        }
      : {
          ...detail,
          sourceType: visible.location.kind,
          sourceCategory: 'original',
          demo:
            linkedEvents.length > 0 && linkedEvents.every((row) => row.demo),
        };
  if (original.kind === 'prototype_snapshot') {
    const subjects =
      resolved.find((row) => sourceKey(row) === sourceKey(reference))
        ?.subjects ?? [];
    if (
      linkedEvents.some((row) => !row.demo) ||
      !subjects.every((subject) =>
        data.directory.people.some(
          (person) => person.id === subject.personId && person.demo,
        ),
      )
    )
      return missing;
  }
  const parsed = sourceSchema.safeParse(source);
  return parsed.success ? { status: 'success', source: parsed.data } : missing;
}
/** Shared source projection for a server-side reader that already loaded one
 * snapshot (BOW-854 matching): every relation for later authorization, and the
 * details of only those sources the current account can read.
 */
export async function projectReadableSources(
  data: SourceData,
): Promise<{ sources: TalentSource[]; details: Source[] }> {
  const sources = completeTalentSources(data);
  const details: Source[] = [];
  for (const source of sources) {
    const read = await sourceFromData(data, source, sources);
    if (read.status === 'success') details.push(read.source);
  }
  return { sources, details };
}
