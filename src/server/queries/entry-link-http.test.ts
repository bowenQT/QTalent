import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const { open } = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('../usecases/entry/open-link', () => ({ openEntryLinkRequest: open }));
vi.mock('../db/client', () => ({ getDatabase: () => ({}) }));
vi.mock('../env', () => ({ getEnv: () => ({ APP_ENV: 'test' }) }));
import { entryLinkResponse, handleEntryLinkOpen } from './entry-link-http';

const link = '/entry/open?kind=material_batch&id=demo-batch&expectedRevision=3';
describe('deep link responses', () => {
  it('sends an anonymous opener to login with only the canonical link', () => {
    const response = entryLinkResponse({
      status: 'authentication_required',
      returnTo: link,
    });
    expect(response.status).toBe(302);
    const location = response.headers.get('Location')!;
    expect(location.startsWith('/login?')).toBe(true);
    expect(
      new URL(location, 'https://site.invalid').searchParams.get('returnTo'),
    ).toBe(link);
    expect(response.headers.get('Cache-Control')).toBe('no-store, private');
  });
  it('redirects ready links to the landing and stale links to the refresh link', () => {
    expect(
      entryLinkResponse({
        status: 'ready',
        target: {
          kind: 'material_batch',
          id: 'demo-batch',
          expectedRevision: 3,
        },
        href: '/receipt?id=demo-batch',
      }).headers.get('Location'),
    ).toBe('/receipt?id=demo-batch');
    expect(
      entryLinkResponse({ status: 'stale', refreshHref: link }).headers.get(
        'Location',
      ),
    ).toBe(link);
  });
  it('answers missing and not permitted objects identically', async () => {
    const denied = entryLinkResponse({ status: 'forbidden' });
    const missing = entryLinkResponse({ status: 'not_found' });
    expect([denied.status, missing.status]).toEqual([404, 404]);
    expect(await denied.text()).toBe(await missing.text());
    expect(denied.headers.get('Location')).toBeNull();
  });
  it.each([
    ['validation_error', 400],
    ['conflict', 409],
    ['unavailable', 503],
  ] as const)('maps %s to %i', (status, code) => {
    expect(entryLinkResponse({ status }).status).toBe(code);
  });
  it('passes the request path and query as the link, never a full URL', async () => {
    open.mockResolvedValueOnce({ status: 'forbidden' });
    const response = await handleEntryLinkOpen(
      new Request('https://site.invalid' + link, {
        headers: { cookie: 'x=1' },
      }),
    );
    expect(response.status).toBe(404);
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ href: link }));
  });
});
