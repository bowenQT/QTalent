import 'server-only';
import type { Workbench } from '../../contracts/workbench';
import type { PersonData } from './person-data';

// TDD scaffold: no fabricated response while the query is unimplemented.
export function workbenchFromData(data: PersonData): Promise<Workbench> {
  const message = '工作台读取尚未实现：' + data.context.account.id;
  return Promise.reject(new Error(message));
}
