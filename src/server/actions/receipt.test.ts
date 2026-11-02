import { expect, it, vi } from 'vitest';
import { readReceiptAction } from './receipt';

const read = vi.hoisted(() => vi.fn());
vi.mock('../queries/receipt-page', () => ({ readReceiptForCurrentUser: read }));

it('reads by batch id and gives the page only the view', async () => {
  read.mockResolvedValue({
    status: 'success',
    view: { title: 't' },
    viewerName: '甲',
  });
  expect(await readReceiptAction('b-1')).toEqual({
    status: 'success',
    view: { title: 't' },
  });
  expect(read).toHaveBeenCalledWith({ batchId: 'b-1' });
});

it('passes refusals and failures through', async () => {
  read.mockResolvedValue({ status: 'unavailable' });
  expect(await readReceiptAction('b-1')).toEqual({ status: 'unavailable' });
});
