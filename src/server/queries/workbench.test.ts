import { expect, it } from 'vitest';
import { fixture } from './person-test-helpers';
import { workbenchFromData } from './workbench';

it('keeps future manager blocks disconnected', async () => {
  expect(await workbenchFromData(fixture('manager'))).toMatchObject({
    role: 'manager',
    myWatch: { status: 'not_connected' },
  });
});

it('reads actual mentor quick views', async () => {
  expect(await workbenchFromData(fixture('mentor'))).toMatchObject({
    role: 'mentor',
    trainees: { status: 'ready' },
  });
});
