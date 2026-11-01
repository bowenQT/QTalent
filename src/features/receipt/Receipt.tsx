import type { ReactNode } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Score } from '@/components/ui/Score';
import { HIDDEN, type DraftCard, type ReceiptView } from './receipt-view';
import './receipt.css';

// The receipt carries no avatar facts for these people; the stylesheet's default hue.
const neutralHue = 220;

function Count({
  value,
  unit,
  children,
}: {
  value: number | null;
  unit: string;
  children?: ReactNode;
}) {
  return (
    <li>
      {value === null ? (
        <>
          {unit}
          <small>读完后统计</small>
        </>
      ) : (
        <>
          <b>{value}</b>
          {unit}
        </>
      )}
      {children}
    </li>
  );
}

function Draft({ draft }: { draft: DraftCard }) {
  return (
    <article
      className="n-card n-rcpt"
      data-state={draft.held ? 'held' : 'ai'}
      id={`rc-${draft.key}`}
    >
      <div className="n-rcpt__head">
        <b>{draft.people.join('、') || '涉及的人已按权限隐藏'}</b>
      </div>
      <h4 className="n-rcpt__title">{draft.title}</h4>
      {draft.quote ? (
        <p className="n-cite__quote n-rcpt__quote">
          {draft.quote.text}
          <small>{draft.quote.where}</small>
        </p>
      ) : null}
      {draft.scores.length ? (
        <div className="n-rcpt__scores">
          {draft.scores.map((score) =>
            score.state === 'suggested' ? (
              <div className="n-rcpt__score" key={score.key}>
                <span className="n-score__dim">{score.dimension}</span>
                <Score
                  state="suggested"
                  dimension={score.dimension}
                  value={score.value as 1 | 2 | 3 | 4 | 5}
                  inline
                />
                <b>{score.value}</b>
                <span className="n-src n-src--ai">
                  <Icon name="spark" />
                  AI 建议
                </span>
                <small />
              </div>
            ) : (
              <div className="n-rcpt__score" key={score.key}>
                <span className="n-score__dim">{score.dimension}</span>
                <Badge className="n-score__empty n-badge--unknown">
                  <Icon name="dash" />
                  资料不足
                </Badge>
                <small>{score.reason}</small>
              </div>
            ),
          )}
        </div>
      ) : null}
      <div className="n-rcpt__foot">
        {draft.held ? (
          <span className="nt-muted">{draft.held}</span>
        ) : (
          <>
            <Badge tone="prep">待接入</Badge>
            <span className="nt-muted">
              确认和改分接通后在这里一件一件做，确认后才计入档案
            </span>
          </>
        )}
      </div>
    </article>
  );
}

/**
 * One delivery's receipt (prototype receipt.html): what was read, who is involved,
 * how many events came out, what still needs checking. Events are confirmed one by
 * one; there is no "confirm all". Confirmation and the 待核对 page are not
 * connected yet, so neither is offered as a link or button.
 */
export function Receipt({ view }: { view: ReceiptView }) {
  const { summary } = view;
  const open = view.reviews.filter((review) => review.result === null).length;
  return (
    <>
      <header className="nt-head">
        <div>
          <h1>{view.title}</h1>
        </div>
        <span className="n-rstate" data-s={view.state[0]}>
          {view.state[1]}
        </span>
      </header>
      {view.error ? (
        <div className="n-notice is-deny" role="alert">
          <Icon name="x" />
          <div>
            <b>这次投递没有整理完：</b>
            {view.error}
          </div>
        </div>
      ) : null}
      <ul className="n-rsum" aria-label="这次读到了什么">
        <li>
          <b>{summary.files}</b>个文件
          {summary.processing ? (
            <small>{summary.processing} 个处理中</small>
          ) : null}
          {summary.failed ? (
            <small className="is-err">{summary.failed} 个处理中断</small>
          ) : null}
          {summary.unsupported ? (
            <small className="is-err">{summary.unsupported} 个待换文件</small>
          ) : null}
        </li>
        <Count value={summary.people} unit="人" />
        <Count value={summary.events} unit="件事" />
        <Count value={summary.reviews} unit="处待核对" />
        <Count value={summary.awaiting} unit="件待确认">
          {summary.confirmed ? <small>已确认 {summary.confirmed}</small> : null}
        </Count>
      </ul>
      <div className="nt-split">
        <div className="nt-grid">
          <article className="n-card">
            <h3 className="n-section-title">文件</h3>
            {view.files.length ? (
              <ul className="n-files" style={{ margin: 0 }}>
                {view.files.map((file) => (
                  <li className="n-file" key={file.key}>
                    <span className="n-file__ext">
                      {(file.name.split('.').pop() ?? '').toUpperCase()}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div className="n-file__name" title={file.name}>
                        {file.name}
                      </div>
                      <div className="n-file__state">
                        <span className={file.tone ?? undefined}>
                          <Icon name={file.icon} size={12} /> {file.label}
                        </span>{' '}
                        · {file.meta}
                      </div>
                      {file.busy ? (
                        <div className="n-progress is-indeterminate">
                          <i />
                        </div>
                      ) : null}
                    </div>
                    <span />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="nt-muted" style={{ margin: 0 }}>
                这次交的是一段文字，没有上传文件。
              </p>
            )}
            {view.stillReading ? (
              <p className="nt-caption">
                还在处理的文件读完后，这份回执会更新；可以先离开。
              </p>
            ) : null}
          </article>
          {view.reviews.length ? (
            <article className="n-card">
              <h3 className="n-section-title">
                待核对
                {open ? <span className="n-count">{open}</span> : null}
              </h3>
              <ul className="nt-list">
                {view.reviews.map((review) => (
                  <li
                    key={review.key}
                    className="nt-row"
                    style={{
                      justifyContent: 'space-between',
                      gap: 'var(--s-3)',
                    }}
                  >
                    <span>
                      <span className="n-kind">{review.kind}</span>{' '}
                      {review.question}
                      {review.result ? (
                        <>
                          {' → '}
                          <b>{review.result}</b>
                        </>
                      ) : null}
                    </span>
                    {review.result ? (
                      <Badge tone="yes">
                        <Icon name="check" />
                        已核对
                      </Badge>
                    ) : (
                      <Badge tone="prep">待接入</Badge>
                    )}
                  </li>
                ))}
              </ul>
            </article>
          ) : null}
          <section id="confirm" className="nt-grid" aria-labelledby="rc-h">
            <h3 className="n-section-title" id="rc-h" style={{ margin: 0 }}>
              整理出的事
              {summary.awaiting ? (
                <span className="n-count">{summary.awaiting}</span>
              ) : null}
            </h3>
            {view.drafts.length ? (
              <p className="nt-muted" style={{ margin: 0 }}>
                一件一件看证据和出处，确认或改分；确认后才进入档案、象限和找人证据。
              </p>
            ) : (
              <div className="nt-empty">
                {view.stillReading
                  ? '整理出的事会出现在这里。'
                  : summary.confirmed
                    ? `这次整理出的 ${summary.confirmed} 件事都已确认。`
                    : '这次的材料里整理出 0 件事，原件已保存。'}
              </div>
            )}
            {view.drafts.map((draft) => (
              <Draft key={draft.key} draft={draft} />
            ))}
            {view.drafts.length && summary.confirmed ? (
              <p className="nt-muted" style={{ margin: 0 }}>
                另有 {summary.confirmed} 件已确认。
              </p>
            ) : null}
            {view.hidden ? (
              <p className="nt-muted" style={{ margin: 0 }}>
                {HIDDEN}
              </p>
            ) : null}
          </section>
        </div>
        <aside className="nt-grid nt-sticky">
          <article className="n-card">
            <h3 className="n-section-title">涉及的人</h3>
            {view.people.length ? (
              <div className="nt-grid" style={{ gap: 'var(--s-2)' }}>
                {view.people.map((person) => (
                  <div className="n-person" key={person.id}>
                    <Avatar name={person.name} hue={neutralHue} />
                    <div>
                      <div className="n-person__name">{person.name}</div>
                      {person.meta ? (
                        <div className="n-person__meta">{person.meta}</div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="nt-muted" style={{ margin: 0 }}>
                {view.hidden
                  ? HIDDEN
                  : view.stillReading
                    ? '读完后列出涉及的人。'
                    : '这次的材料里没有确定涉及的人。'}
              </p>
            )}
          </article>
        </aside>
      </div>
    </>
  );
}
