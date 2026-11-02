import { beforeEach, expect, it, vi } from 'vitest';
const runtime = vi.hoisted(() => ({
  session: vi.fn(),
  create: vi.fn(),
  select: vi.fn(),
  read: vi.fn(),
  page: vi.fn(),
}));
vi.mock('../auth/next', () => ({ requireSession: runtime.session }));
vi.mock('../usecases/record-arrange-runtime', () => ({
  recordArrangeRequestsForServer: () => ({
    create: runtime.create,
    select: runtime.select,
    read: runtime.read,
    page: runtime.page,
  }),
}));
import {
  startRecordArrangeAction,
  selectRecordArrangePeopleAction,
} from './record-arrange';
import {
  getRecordPage,
  readRecordArrangeJobForCurrentUser,
} from '../queries/record-arrange';
beforeEach(() => {
  vi.clearAllMocks();
  runtime.session.mockResolvedValue({ user: { id: 'trusted-session' } });
});
it('obtains the actor only from the server session for both write actions', async () => {
  runtime.create.mockResolvedValue({ status: 'success' });
  runtime.select.mockResolvedValue({ status: 'conflict' });
  const input = { actorAccountId: 'untrusted' };
  await startRecordArrangeAction(input);
  await selectRecordArrangePeopleAction(input);
  expect(runtime.create).toHaveBeenCalledWith('trusted-session', input);
  expect(runtime.select).toHaveBeenCalledWith('trusted-session', input);
});
it('does not enter storage after the session boundary fails', async () => {
  runtime.session.mockRejectedValue(new Error('session unavailable'));
  await expect(startRecordArrangeAction({})).rejects.toThrow(
    'session unavailable',
  );
  expect(runtime.create).not.toHaveBeenCalled();
});
it('validates a job query before reading and uses the current session', async () => {
  expect(await readRecordArrangeJobForCurrentUser({ jobId: 2 })).toEqual({
    status: 'validation_error',
  });
  expect(runtime.read).not.toHaveBeenCalled();
  runtime.read.mockResolvedValue({ status: 'not_found' });
  expect(await readRecordArrangeJobForCurrentUser({ jobId: 'job' })).toEqual({
    status: 'not_found',
  });
  expect(runtime.read).toHaveBeenCalledWith('trusted-session', 'job');
});
it('reads initial context using the current session and never accepts URL original text', async () => {
  runtime.page.mockResolvedValue({
    status: 'success',
    context: { people: [] },
  });
  await getRecordPage({ personId: 'person' });
  expect(runtime.page).toHaveBeenCalledWith('trusted-session', {
    personId: 'person',
    projectId: null,
  });
  expect(await getRecordPage({ q: 'sensitive raw input' })).toEqual({
    status: 'validation_error',
  });
  expect(runtime.page).toHaveBeenCalledOnce();
});
