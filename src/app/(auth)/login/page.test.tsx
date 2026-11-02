// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import Login from './page';

vi.mock('@/features/auth/LoginForm', () => ({
  LoginForm: ({ returnTo }: { returnTo: string }) => (
    <p data-testid="return-to">{returnTo}</p>
  ),
}));
afterEach(cleanup);
const link =
  '/entry/open?kind=staffing_demand&id=demo-demand&expectedRevision=2';
async function returnTo(value?: string | string[]) {
  const view = render(
    await Login({
      searchParams: Promise.resolve(
        value === undefined ? {} : { returnTo: value },
      ),
    }),
  );
  return view.getByTestId('return-to').textContent;
}
describe('login return target', () => {
  it('enters the workbench when nothing asked to return', async () => {
    expect(await returnTo()).toBe('/work');
  });
  it('returns to a canonical deep link', async () => {
    expect(await returnTo(link)).toBe(link);
  });
  it.each([
    'https://evil.example/entry/open?kind=staffing_demand&id=x&expectedRevision=1',
    '//evil.example/entry/open?kind=staffing_demand&id=x&expectedRevision=1',
    '/\\evil.example',
    link + '#top',
    link + '&next=//evil.example',
    '/projects',
    'javascript:alert(1)',
  ])('refuses any other return target (%s) and goes home', async (value) => {
    expect(await returnTo(value)).toBe('/');
  });
  it('refuses a repeated returnTo parameter', async () => {
    expect(await returnTo([link, link])).toBe('/');
  });
});
