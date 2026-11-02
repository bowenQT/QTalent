import { Icon } from '@/components/ui/Icon';
import { State } from '@/components/ui/State';
import type { ComparisonMapping } from '@/contracts/judgment-comparison';
import { ShellTitle } from '@/features/shell/ShellTitle';
import { CaseCard } from './CaseCard';
import {
  gradeLine,
  restLine,
  sampleSummary,
  sortCases,
  type DisplayCase,
  type RaterSample,
} from './comparison-view';
import '../standard-iteration.css';

/**
 * One rater's judgments. The rater sees only their own, each stage only under a current
 * relation on the same node; HR can open any rater. Nothing here enters a profile.
 */
export function JudgeRater({
  self,
  raterName,
  cases,
  sample,
  mapping,
  back,
  batchNames = {},
}: {
  /** The viewer is this rater: 我的判断对照, later quotes hidden. */
  self: boolean;
  raterName: string;
  cases: readonly DisplayCase[];
  sample: RaterSample;
  /** The batch mapping, for the order of front grades; null when the viewer has none. */
  mapping: ComparisonMapping | null;
  back: { href: string; label: string };
  /** Batch names the caller knows; otherwise the cohort names the group. */
  batchNames?: Readonly<Record<string, string>>;
}) {
  const title = self ? '我的判断对照' : `${raterName}的判断`;
  const mappingVersionId = cases[0]?.mappingVersionId ?? '';
  const batches = [...new Set(cases.map((unit) => unit.batchId))];
  if (!cases.length)
    return (
      <>
        <ShellTitle title={title} />
        <header className="nt-head">
          <div>
            <h1>{title}</h1>
          </div>
        </header>
        <State
          title={
            self
              ? '你作为评价人给出的判断会出现在这里'
              : '这位评价人的判断会出现在这里'
          }
          text="每条判断和后一阶段对同一个人同一维度的结论放在一起，供修订人才评价规则参考。"
        />
      </>
    );
  return (
    <>
      <ShellTitle title={title} />
      <header className="nt-head">
        <div>
          <h1>{title}</h1>
          <p>
            {self
              ? '这里是你做过的判断，和后一阶段对同一个人同一维度的等级与差异状态。'
              : '按评价人看偏差，按姓名排列。案例少于门槛时只列案例。'}
          </p>
        </div>
      </header>
      <div className="nt-split">
        <div className="nt-grid">
          <article className="n-card">
            <h3 className="n-section-title">
              {sample.state === 'sufficient_sample'
                ? `${sample.comparableCaseCount} 个可对照案例`
                : '样本不足'}
            </h3>
            <p style={{ margin: 0 }}>{sampleSummary(sample, cases)}</p>
            <p className="nt-caption">
              {/* Below the threshold no per-rater numbers, only the cases. */}
              {sample.state === 'sufficient_sample'
                ? gradeLine(self ? '你' : raterName, cases, mapping)
                : null}
              可对照案例（含中间档）都计入门槛，偏高、偏低、一致只算最高或最低一档。
              {restLine(cases)}
            </p>
          </article>
          {batches.map((batchId) => {
            const units = sortCases(
              cases.filter((unit) => unit.batchId === batchId),
            );
            return (
              <section key={batchId}>
                <h2 className="nt-h2">
                  {batchNames[batchId] ?? units[0].cohort.name}
                  <small>{units[0].selectionStandardVersionId}</small>
                </h2>
                {units.map((unit) => (
                  <CaseCard
                    key={unit.id}
                    unit={unit}
                    mappingVersionId={mappingVersionId}
                    raterOnly={self}
                  />
                ))}
              </section>
            );
          })}
        </div>
        <aside className="nt-grid">
          <a className="n-btn n-btn--ghost" href={back.href}>
            <Icon name="back" />
            {back.label}
          </a>
          {self ? (
            <div className="n-lock">
              <Icon name="lock" />
              这里只列你现在有效的评价关系里的判断；后段的关系已失效或由其他评价人负责时，那一段显示无权限。
            </div>
          ) : null}
          <div className="n-lock">
            <Icon name="info" />
            这些对照只用来修正人才评价规则：结论不改变被评价人的分数、象限和档案，也不进入评价人本人的档案。
          </div>
        </aside>
      </div>
    </>
  );
}
