import 'server-only';
import { personReadInputSchema } from '../../contracts/person';
import { personFromData } from './person-projection';
import { loadCurrentPersonData } from './person-session';
import { quickViewOf } from './people';

export async function readPersonForCurrentUser(input: unknown) {
  const { id } = personReadInputSchema.parse(input);
  const person = await personFromData(await loadCurrentPersonData(), id);
  return person
    ? { status: 'success' as const, person }
    : { status: 'not_found' as const, message: '人员不存在或不可见' };
}
export async function readPersonPreviewForCurrentUser(input: unknown) {
  const result = await readPersonForCurrentUser(input);
  return result.status === 'success'
    ? { status: 'success' as const, person: quickViewOf(result.person) }
    : result;
}
