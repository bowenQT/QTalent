import { describe, expect, it } from 'vitest';
import { createClock } from './clock';
describe('clock', () => {
  it('freezes demo and test clocks without leaking mutable Date objects', () => {
    const clock = createClock('demo');
    clock.now().setFullYear(1990);
    expect(clock.today()).toBe('2026-09-04');
    expect(createClock('test').today()).toBe('2026-09-04');
  });
  it('uses the injected real clock in other environments', () => {
    expect(
      createClock('production', () => new Date('2030-01-02T03:00:00Z')).today(),
    ).toBe('2030-01-02');
  });
});
