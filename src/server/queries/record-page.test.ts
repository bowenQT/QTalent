import { expect, it, vi } from 'vitest';
import { redirect } from 'next/navigation';
import { getRecordPage } from './record-arrange';
import { getRecordPageData } from './record-page';

vi.mock('./record-arrange', () => ({ getRecordPage: vi.fn() }));
vi.mock('../db/client', () => ({ getDatabase: vi.fn() }));

it('states a failed read as unavailable', async () => {
  vi.mocked(getRecordPage).mockRejectedValue(new Error('connection lost'));
  expect(await getRecordPageData()).toEqual({ status: 'unavailable' });
});

it('lets the sign-in redirect through', async () => {
  vi.mocked(getRecordPage).mockImplementation(async () => redirect('/login'));
  await expect(getRecordPageData()).rejects.toMatchObject({
    digest: expect.stringContaining('NEXT_REDIRECT'),
  });
});
