import 'server-only';
import { getDatabase } from '../db/client';
import { recordAudit } from '../platform/audit';
import {
  sourceReadInputSchema,
  sourceSchema,
  type SourceReadResult,
} from '../../contracts/sources';
import { readTalentSource, type TalentSource } from '../authz/talent';
import { ForbiddenError } from '../usecases/project-context';
import { type PersonData, talentSources, sourceKey } from './person-data';
import { loadCurrentPersonData } from './person-session';

export async function sourceFromData(
  data: PersonData,
  reference: { fragmentId: string; originalVersionId: string },
  // Callers that read many sources pass the already resolved relations.
  resolved: TalentSource[] = talentSources(data),
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
export async function readSourceForCurrentUser(
  input: unknown,
): Promise<SourceReadResult> {
  const parsed = sourceReadInputSchema.safeParse(input);
  if (!parsed.success)
    return {
      status: 'validation_error',
      fieldErrors: { source: ['请提供有效的片段和原件版本'] },
      input,
    };
  try {
    const data = await loadCurrentPersonData();
    const result = await sourceFromData(data, parsed.data);
    if (result.status === 'success')
      await recordAudit(getDatabase(), {
        actorId: data.context.account.id,
        action: 'source.read',
        resourceId: sourceKey(parsed.data),
      });
    return result;
  } catch (error) {
    if (error instanceof ForbiddenError)
      return { status: 'forbidden', message: '当前账号没有业务读取权限' };
    throw error;
  }
}
