// Business dates are shown in the company's time zone, as the prototype's MM-DD.
const parts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  month: '2-digit',
  day: '2-digit',
});

export function formatDay(iso: string): string {
  const values = Object.fromEntries(
    parts.formatToParts(new Date(iso)).map((part) => [part.type, part.value]),
  );
  return `${values.month}-${values.day}`;
}

const clock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Shanghai',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** A time of day in the company's time zone, as 10:30. */
export function formatClock(iso: string): string {
  return clock.format(new Date(iso));
}

export function personHref(personId: string): string {
  return `/person?id=${encodeURIComponent(personId)}`;
}

export function projectHref(projectId: string): string {
  return `/project?id=${encodeURIComponent(projectId)}`;
}
