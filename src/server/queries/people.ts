import 'server-only';
import {
  peopleInputSchema,
  peopleListSchema,
  quickViewSchema,
  type PeopleList,
  type QuickView,
} from '../../contracts/people';
import type { Person } from '../../contracts/person';
import { ForbiddenError } from '../usecases/project-context';
import type { PersonData } from './person-data';
import { personFromData, personRole } from './person-projection';
import { loadCurrentPersonData } from './person-session';

export function quickViewOf(person: Person): QuickView {
  const shared = {
    role: person.role,
    person: person.person,
    summary: person.summary,
    capabilityProfile: person.capabilityProfile,
    projects: person.projects,
  };
  return quickViewSchema.parse(
    person.role === 'mentor'
      ? shared
      : { ...shared, referencePosition: person.referencePosition },
  );
}
export async function peopleFromData(
  data: PersonData,
  input: unknown = {},
): Promise<PeopleList> {
  const filter = peopleInputSchema.parse(input);
  const role = personRole(data);
  if (!role) throw new ForbiddenError();
  const people: QuickView[] = [];
  for (const row of data.directory.people) {
    const profile = await personFromData(data, row.id);
    if (!profile) continue;
    const person = profile.person;
    if (filter.teamId && person.teamId !== filter.teamId) continue;
    if (
      filter.query &&
      !person.name
        .toLocaleLowerCase()
        .includes(filter.query.toLocaleLowerCase())
    )
      continue;
    people.push(quickViewOf(profile));
  }
  people.sort((a, b) =>
    a.person.teamName.localeCompare(b.person.teamName) ||
    a.person.name.localeCompare(b.person.name) ||
    a.person.id.localeCompare(b.person.id),
  );
  return peopleListSchema.parse({ role, people, total: people.length });
}
export async function listPeopleForCurrentUser(input: unknown = {}) {
  return peopleFromData(await loadCurrentPersonData(), input);
}
