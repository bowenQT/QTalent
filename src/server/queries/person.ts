import 'server-only';
import { getDatabase } from '../db/client';
import { recordAudit } from '../platform/audit';
import { personReadInputSchema } from '../../contracts/person';
import { personFromData } from './person-projection';
import { loadCurrentPersonData } from './person-session';
import { quickViewFromData } from './people';

export async function readPersonForCurrentUser(input: unknown) {
  const { id } = personReadInputSchema.parse(input);
  const data = await loadCurrentPersonData();
  const person = await personFromData(data, id);
  if (person)
    await recordAudit(getDatabase(), {
      actorId: data.context.account.id,
      action: 'person.read',
      resourceId: id,
    });
  return person
    ? { status: 'success' as const, person }
    : { status: 'not_found' as const, message: '人员不存在或不可见' };
}
export async function readPersonPreviewForCurrentUser(input: unknown) {
  const { id } = personReadInputSchema.parse(input);
  const data = await loadCurrentPersonData();
  const person = await quickViewFromData(data, id);
  if (person)
    await recordAudit(getDatabase(), {
      actorId: data.context.account.id,
      action: 'person.read',
      resourceId: id,
    });
  return person
    ? { status: 'success' as const, person }
    : { status: 'not_found' as const, message: '人员不存在或不可见' };
}
