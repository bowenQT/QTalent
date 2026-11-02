import type { PersonPrintSheet, PrintScore, PrintSource } from './ports';

/** `YYYY-MM-DD` as the print writes it: `MM-DD`. */
export const monthDay = (day: string) => day.slice(5);

/** Organization · title · level · tenure · cohort; missing parts are left out. */
export function identityLine(person: PersonPrintSheet['person']): string {
  return [
    person.teamPath,
    person.jobTitle,
    person.level,
    person.tenureLabel,
    person.batchName,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * One event writes its source once when every score's quote sits in the same place, and
 * per score otherwise (the same judgment as the confirmed-content export, BOW-912).
 */
export function sharedSource(
  scores: readonly PrintScore[],
): PrintSource | null {
  const [first] = scores;
  if (!first?.source) return null;
  return scores.every(
    (score) =>
      score.source?.text === first.source?.text &&
      score.source?.exact === first.source?.exact,
  )
    ? first.source
    : null;
}

export const sourceLine = (source: PrintSource) =>
  `${source.exact ? '来源' : '全部来源'}：${source.text}`;

export function formalLine(
  position: NonNullable<PersonPrintSheet['formalPosition']>,
): string {
  return position.status === 'ready'
    ? `${position.quadrantLabel} · ${position.calibrationLabel}校准 · ${monthDay(position.frozenOn)} 冻结 · ${position.confirmedByName}确认`
    : '待正式校准';
}

/** Events with at least one confirmed score, and how many scores they hold. */
export function printedEvents(sheet: PersonPrintSheet) {
  const events = sheet.events.filter((event) => event.scores.length > 0);
  return {
    events,
    scoreCount: events.reduce((sum, event) => sum + event.scores.length, 0),
  };
}
