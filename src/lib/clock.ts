export interface Clock {
  now(): Date;
  today(): string;
}
/** Callers explicitly select the environment; production never inherits demo time. */
export function createClock(
  environment: string,
  realNow: () => Date = () => new Date(),
): Clock {
  const now =
    environment === 'demo' || environment === 'test'
      ? () => new Date('2026-09-04T00:00:00.000Z')
      : realNow;
  return { now, today: () => now().toISOString().slice(0, 10) };
}
