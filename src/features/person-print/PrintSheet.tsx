import type { PersonPrintSheet } from './ports';
import { sheetFoot, sheetTerms } from './copy';
import {
  formalLine,
  identityLine,
  monthDay,
  printedEvents,
  sharedSource,
  sourceLine,
} from './print-view';

/** The printed profile: confirmed content only, with who printed it, when and on what terms. */
export function PrintSheet({ sheet }: { sheet: PersonPrintSheet }) {
  const { person } = sheet;
  const { events, scoreCount } = printedEvents(sheet);
  return (
    <>
      <header className="n-print__head">
        <h1>
          {person.name}
          {person.demo ? (
            <>
              {' '}
              <small>演示</small>
            </>
          ) : null}
        </h1>
        <p>{identityLine(person)}</p>
      </header>
      <dl className="n-print__meta">
        <dt>打印时间</dt>
        <dd>{sheet.printedAt}</dd>
        <dt>打印人</dt>
        <dd>{sheet.printedByName}</dd>
        <dt>口径</dt>
        <dd>{sheetTerms}</dd>
      </dl>
      {sheet.summary ? (
        <section>
          <h2>
            档案摘要 <small>AI 生成 · 经人采纳</small>
          </h2>
          <p>{sheet.summary.text}</p>
          <p className="n-print__by">
            {sheet.summary.adoptedByName} {monthDay(sheet.summary.adoptedOn)}{' '}
            采纳 AI 摘要
          </p>
        </section>
      ) : null}
      {sheet.formalPosition ? (
        <section>
          <h2>能力象限 · 正式位置</h2>
          <p>{formalLine(sheet.formalPosition)}</p>
        </section>
      ) : null}
      <section>
        <h2>
          关键事件与已确认的维度分{' '}
          <small>
            {events.length} 件 · {scoreCount} 条
          </small>
        </h2>
        {events.length ? (
          <ol className="n-print__evs">
            {events.map((event) => {
              const shared = sharedSource(event.scores);
              return (
                <li key={event.id}>
                  <p className="n-print__ev">
                    <b>
                      {monthDay(event.occurredOn)} · {event.title}
                    </b>
                    {event.projectName ? ` · ${event.projectName}` : ''} ·{' '}
                    {event.recorderName}记录
                  </p>
                  <ul>
                    {event.scores.map((score) => (
                      <li key={score.id}>
                        {score.dimensionLabel} {score.value} ·{' '}
                        {score.scoredByName}评 · {score.ruleVersionLabel}
                        <br />
                        <span>
                          锚点 {score.value}：{score.anchor}
                        </span>
                        {score.quote ? (
                          <>
                            <br />
                            <span>{score.quote}</span>
                          </>
                        ) : null}
                        {!shared && score.source ? (
                          <>
                            <br />
                            <span className="n-print__src">
                              {sourceLine(score.source)}
                            </span>
                          </>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {shared ? (
                    <p className="n-print__src">{sourceLine(shared)}</p>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : (
          <p>已确认的维度分 0 条。</p>
        )}
      </section>
      <footer className="n-print__foot">{sheetFoot(person.demo)}</footer>
    </>
  );
}
