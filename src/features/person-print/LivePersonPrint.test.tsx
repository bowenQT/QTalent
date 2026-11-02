// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/Toast';
import { Person } from '@/features/person/Person';
import { fixtures } from '../../../tests/fixtures/p0-contracts';
import { LivePersonPrint } from './LivePersonPrint';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(cleanup);

const [manager, mentor] = fixtures.person;
// As the person page mounts it: the entry in the head, or for the mentor only the sheet.
const show = (data: typeof manager, withPrint: boolean) => {
  const print = (canPrint: boolean) => (
    <LivePersonPrint
      personId={data.person.id}
      personName={data.person.name}
      canPrint={canPrint}
    />
  );
  const mentorView = data.role === 'mentor';
  return render(
    <ToastProvider>
      <Person
        data={data}
        loadSource={vi.fn()}
        headActions={withPrint && !mentorView ? print(true) : undefined}
      />
      {withPrint && mentorView ? print(false) : null}
    </ToastProvider>,
  );
};

describe('print entry on the person head', () => {
  it('leaves the head as it was when the page passes no actions', () => {
    const { container } = show(manager, false);
    expect(container.querySelector('.nt-head__acts')).toBeNull();
    expect(screen.queryByRole('button', { name: '打印档案' })).toBeNull();
  });

  it('puts 「打印档案」 in the head actions and says printing is not connected', async () => {
    const { container } = show(manager, true);
    const button = screen.getByRole('button', { name: '打印档案' });
    expect(button.closest('.nt-head__acts')?.parentElement).toBe(
      container.querySelector('header.nt-head'),
    );
    fireEvent.click(button);
    expect(
      await screen.findByRole('dialog', { name: '档案打印待接通' }),
    ).toBeTruthy();
  });

  it('gives the mentor no entry, only the line a plain browser print shows', () => {
    const { container } = show(mentor, true);
    expect(screen.queryByRole('button', { name: '打印档案' })).toBeNull();
    // The mentor's head stays as it was.
    expect(container.querySelector('.nt-head__acts')).toBeNull();
    expect(document.getElementById('print-sheet')?.textContent).toContain(
      '档案打印只对管理者和这个人的归属 HR 开放',
    );
  });
});
