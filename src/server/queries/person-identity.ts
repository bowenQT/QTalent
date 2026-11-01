import type { PersonIdentity } from '../../contracts/person';
import { activeGrants, canReadProject, isCurrent } from '../authz';
import { type PersonData, personBusinessDay } from './person-data';

type Row = PersonData['directory']['people'][number];
const day = 86_400_000;

/** Code-point order, the stable tail of every list order. */
export const byCodePoint = (a: string, b: string) =>
  a < b ? -1 : a > b ? 1 : 0;
const zh = new Intl.Collator('zh');
export const byPinyin = (a: string, b: string) => zh.compare(a, b);

/** Same wording as the final prototype's `store.tenure`; the prefix says which
 * start date was used. The business day comes from the server, never the client.
 */
function tenure(prefix: string, from: string, asOf: string): string | null {
  const days = Math.floor((Date.parse(asOf) - Date.parse(from)) / day);
  if (!Number.isFinite(days) || days < 0) return null;
  return days < 60
    ? `${prefix} ${Math.max(1, Math.round(days / 7))} 周`
    : days < 365
      ? `${prefix} ${Math.round(days / 30)} 个月`
      : `${prefix} ${Math.floor(days / 365)} 年`;
}
const covers = (data: PersonData, cohortId: string) =>
  activeGrants(data.context).some(
    (grant) => grant.scope === 'company' || grant.cohortId === cohortId,
  );
/** The one batch context (R1.4): a confirmed, unrevoked enrolment valid on the
 * business day inside the caller's grants; the latest start wins, ties go to the
 * smallest cohort id. Tenure, landing and the workbench topic all use it.
 */
export function batchOf(data: PersonData, personId: string) {
  const picked = data.context.enrollments
    .filter(
      (entry) =>
        entry.personId === personId &&
        entry.confirmed &&
        isCurrent(entry, data.context.now) &&
        covers(data, entry.cohortId) &&
        data.cohorts.some((cohort) => cohort.id === entry.cohortId),
    )
    .sort(
      (a, b) =>
        byCodePoint(b.validFrom, a.validFrom) ||
        byCodePoint(a.cohortId, b.cohortId),
    )[0];
  const cohort = picked
    ? data.cohorts.find((row) => row.id === picked.cohortId)
    : undefined;
  return picked && cohort ? { enrollment: picked, cohort } : null;
}
export function identityOf(data: PersonData, person: Row): PersonIdentity {
  const organization = data.directory.organizations.find(
    (row) => row.id === person.organizationId,
  );
  if (!organization) throw new Error('人员组织引用不存在');
  const batch = batchOf(data, person.id);
  const hired = data.employments
    .filter((row) => row.personId === person.id)
    .map((row) => row.validFrom)
    .sort(byCodePoint)[0];
  const asOf = personBusinessDay(data);
  return {
    id: person.id,
    name: person.name,
    hue: person.hue,
    photo: person.photo,
    demo: person.demo,
    teamId: organization.id,
    teamName: organization.shortName,
    // The organization table has no parent (BOW-834 S2): a single-level path.
    teamPath: organization.name,
    // No job title column yet (BOW-834 S1).
    jobTitle: '职位未接入',
    level: null,
    batch: batch ? { id: batch.cohort.id, name: batch.cohort.name } : null,
    tenureLabel: batch
      ? tenure('入营', batch.enrollment.validFrom, asOf)
      : hired
        ? tenure('入职', hired, asOf)
        : null,
  };
}
/** The topic and mentors of the selected batch. Mentor names are provenance of
 * the student's record, so they do not require the mentor's own profile.
 */
export function landingOf(data: PersonData, personId: string) {
  const batch = batchOf(data, personId);
  if (!batch) return null;
  const now = data.context.now;
  const topics = data.staffing.projects.filter(
    (project) =>
      project.isTopic &&
      project.cohortId === batch.cohort.id &&
      canReadProject(data.context, project) &&
      data.staffing.members.some(
        (member) =>
          member.projectId === project.id &&
          member.personId === personId &&
          member.validFrom <= now,
      ),
  );
  const mentorNames = data.context.assignments
    .filter(
      (entry) =>
        entry.kind === 'mentor' &&
        entry.studentId === personId &&
        entry.cohortId === batch.cohort.id &&
        isCurrent(entry, now),
    )
    .flatMap((entry) => {
      const mentor = data.directory.people.find(
        (row) => row.id === entry.personId,
      );
      return mentor ? [mentor.name] : [];
    });
  return {
    topicName: topics.length === 1 ? topics[0].name : null,
    mentorNames: [...new Set(mentorNames)].sort(byPinyin),
  };
}
