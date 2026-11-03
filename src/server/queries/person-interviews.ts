import { activeGrants } from '../authz';
import { profileGate } from './person-projection';
import { canReadTalent, projectTalentRecord } from '../authz/talent';
import { materialSourceReferenceSchema } from '../../contracts/sources';
import {
  interviewArchiveRecordSchema,
  type InterviewArchiveBlock,
  type InterviewArchiveRecord,
} from '../../contracts/interview-archive';
import {
  archiveScale,
  INTERVIEW_HISTORY_KIND,
} from '../usecases/interview-import/archive-model';
import { archiveFragmentId } from '../usecases/interview-import/archive';
import {
  completeTalentSources,
  historicalSubject,
  type PersonData,
} from './person-data';

/** Called by the existing person query with its exact snapshot. No undefined
 * block is sent to employees/evaluators; absence is not a hidden-item count. */
export async function personInterviewArchiveFromData(
  data: PersonData,
  personId: string,
): Promise<InterviewArchiveBlock | undefined> {
  if (
    data.context.account.isSystemAdmin ||
    !activeGrants(data.context).some(
      (grant) => grant.role === 'manager' || grant.role === 'hr',
    )
  )
    return undefined;
  if (!profileGate(data, personId)) return undefined;
  const sources = completeTalentSources(data);
  const records: InterviewArchiveRecord[] = [];
  const nameOf = (id: string) => {
    const person = data.directory.people.find((person) => person.id === id);
    return person
      ? person.demo
        ? `${person.name}（演示）`
        : person.name
      : null;
  };
  for (const { archive, history, row, operation } of data.interviewArchives) {
    if (
      archive.withdrawnAt !== null ||
      history.personId !== personId ||
      history.kind !== INTERVIEW_HISTORY_KIND ||
      history.sourceCategory !== 'original'
    )
      continue;
    const subject = historicalSubject(data, history, personId);
    if (
      !canReadTalent(
        data.context,
        { ...subject, kind: 'interview-evaluation' },
        'person-profile',
      )
    )
      continue;
    const review =
      row.parsed.status === 'rejected'
        ? null
        : row.parsed.reviews[row.reviewIndex];
    const primary = data.fragments.find(
      (fragment) =>
        fragment.id === history.fragmentId &&
        fragment.originalVersionId === history.originalVersionId,
    );
    const interviewerName = nameOf(history.recorderId);
    const importedByName = nameOf(archive.importerPersonId);
    if (
      !review ||
      !primary?.parseVersionId ||
      !interviewerName ||
      !importedByName ||
      operation.action !== 'confirm'
    )
      continue;
    const originalScale = archiveScale(review, operation.after.filled);
    if (
      JSON.stringify(history.scale) !==
      JSON.stringify(originalScale.map(({ item, value }) => [item, value]))
    )
      continue;
    const referenced = data.fragments.filter(
      (fragment) =>
        fragment.parseVersionId === primary.parseVersionId &&
        fragment.originalVersionId === primary.originalVersionId,
    );
    const references = referenced.map((fragment) => ({
      fragmentId: fragment.id,
      originalVersionId: fragment.originalVersionId,
    }));
    const projected = projectTalentRecord(
      data.context,
      {
        id: history.id,
        subject,
        kind: 'interview-evaluation',
        fields: [
          {
            name: 'title',
            kind: 'interview-evaluation',
            value: review.template,
            subjects: [],
            sources: references,
          },
        ],
      },
      sources,
      'person-profile',
    );
    if (
      !projected ||
      projected.fields.title !== review.template ||
      projected.sources.length !== references.length
    )
      continue;
    const canonical = projected.sources.map((source) =>
      materialSourceReferenceSchema.safeParse({
        fragmentId: source.fragmentId,
        originalVersionId: source.originalVersionId,
        location: source.location,
      }),
    );
    if (canonical.some((source) => !source.success)) continue;
    const citations = canonical.flatMap((source) =>
      source.success ? [source.data] : [],
    );
    const scale = originalScale.map((item, index) => ({
      item: history.scale[index][0],
      value: history.scale[index][1],
      origin: item.origin,
      sources: item.regions.flatMap((_, region) =>
        citations.filter(
          (source) =>
            source.fragmentId ===
            archiveFragmentId(
              primary.parseVersionId!,
              `scale-${index}`,
              region,
            ),
        ),
      ),
    }));
    if (
      scale.some(
        (item, index) =>
          item.sources.length !== originalScale[index].regions.length,
      )
    )
      continue;
    records.push(
      interviewArchiveRecordSchema.parse({
        kind: 'interview',
        id: history.id,
        title: review.template,
        occurredOn: history.occurredOn,
        interviewerName,
        interviewerConfirmedInSystem: false,
        importedByName,
        importedAt: new Date(operation.at).toISOString(),
        scale,
        sources: citations,
      }),
    );
  }
  records.sort(
    (a, b) =>
      b.occurredOn.localeCompare(a.occurredOn) || a.id.localeCompare(b.id),
  );
  return records.length
    ? { status: 'ready', data: records }
    : { status: 'empty' };
}
