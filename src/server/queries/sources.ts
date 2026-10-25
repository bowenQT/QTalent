import 'server-only';
import {
  sourceReadInputSchema,
  sourceSchema,
  type SourceReadResult,
} from '../../contracts/sources';
import { readTalentSource } from '../authz/talent';
import { ForbiddenError } from '../usecases/project-context';
import { type PersonData, talentSources, sourceKey } from './person-data';
import { loadCurrentPersonData } from './person-session';

export async function sourceFromData(
  data: PersonData,
  reference: { fragmentId: string; originalVersionId: string },
): Promise<SourceReadResult> {
  const visible = await readTalentSource(
    async () => ({
      context: data.context,
      records: [],
      sources: talentSources(data),
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
  const source =
    original.kind === 'prototype_snapshot'
      ? {
          ...visible,
          sourceType: 'prototype_snapshot',
          sourceCategory: 'prototype_baseline',
          demo: true,
          displayNotice: original.displayNotice,
        }
      : {
          ...visible,
          sourceType: visible.location.kind,
          sourceCategory: 'original',
          demo:
            linkedEvents.length > 0 && linkedEvents.every((row) => row.demo),
        };
  if (original.kind === 'prototype_snapshot') {
    const subjects =
      talentSources(data).find((row) => sourceKey(row) === sourceKey(reference))
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
    return sourceFromData(data, parsed.data);
  } catch (error) {
    if (error instanceof ForbiddenError)
      return { status: 'forbidden', message: '当前账号没有业务读取权限' };
    throw error;
  }
}
