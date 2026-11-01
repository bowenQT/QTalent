import { Badge } from '@/components/ui/Badge';
import { State } from '@/components/ui/State';
import type { ComparisonManagerPage } from '@/contracts/judgment-comparison';
import { categoryLabel } from '../copy';
import { LockNote } from './SideCards';

export const judgeIntro =
  '把招聘、入营这类前段判断，和后一阶段对同一个人同一维度的判断放在一起对照，找出评价标准、评价人和评价方式里的系统性偏差，结论回到规则修订。';

/**
 * The manager's summary is a separate response: per batch only how many people
 * disagree and the confirmed attribution categories. No cases, names or raters.
 */
export function JudgeManager({ page }: { page: ComparisonManagerPage }) {
  return (
    <>
      <header className="nt-head">
        <div>
          <h1>判断对照</h1>
          <p>{judgeIntro}</p>
        </div>
      </header>
      <div className="nt-split">
        <div className="nt-grid" style={{ gap: 'var(--s-3)' }}>
          {page.batches.length ? (
            page.batches.map(
              ({ batch, discrepancyPeople, attributionCategories }) => (
                <article
                  key={batch.id}
                  className="n-card"
                  data-testid="judge-batch"
                >
                  <div
                    className="nt-row"
                    style={{ justifyContent: 'space-between' }}
                  >
                    <b>{batch.name}</b>
                    {attributionCategories.length ? (
                      <Badge tone="seal" icon="stamp">
                        已归因
                      </Badge>
                    ) : (
                      <Badge>归因待确认</Badge>
                    )}
                  </div>
                  <div className="nt-muted" style={{ marginTop: 2 }}>
                    {batch.cohort.name} · 标准{' '}
                    {batch.selectionStandardVersionId} · 对应表{' '}
                    {batch.mappingVersionId}
                  </div>
                  <p
                    style={{
                      margin: 'var(--s-2) 0 0',
                      fontSize: 'var(--t-sm)',
                    }}
                  >
                    {discrepancyPeople} 人前后判断不一致
                  </p>
                  {attributionCategories.length ? (
                    <div className="nt-row" style={{ marginTop: 'var(--s-2)' }}>
                      {attributionCategories.map((category) => (
                        <span
                          key={category}
                          className="n-badge"
                          style={{ background: 'var(--ink)', color: '#fff' }}
                        >
                          {categoryLabel[category]}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </article>
              ),
            )
          ) : (
            <State
              card
              title="判断对照会出现在这里"
              text="HR 发起对照并确认归因后，这里列出每批的不一致人数和归因类别。"
            />
          )}
        </div>
        <aside className="nt-grid">
          <LockNote />
        </aside>
      </div>
    </>
  );
}
