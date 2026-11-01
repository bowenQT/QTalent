import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import type {
  ComparisonHrPage,
  ComparisonMapping,
} from '@/contracts/judgment-comparison';
import type { SelectionStandardContent } from '../ports';
import { hueOf, monthDay, stage } from '../copy';
import { mappingText, raterLine } from './comparison-view';

const th = {
  textAlign: 'left',
  color: 'var(--ink-3)',
  fontWeight: 500,
} as const;

/** The mapping and front standard the batch was compared by. */
export function RuleCard({
  mapping,
  judgmentName,
  standardVersionId,
  standard,
}: {
  mapping: ComparisonMapping;
  judgmentName: string;
  standardVersionId: string;
  /** Content of the bound standard version, when its read is connected. */
  standard: SelectionStandardContent | null;
}) {
  return (
    <article className="n-card">
      <h3 className="n-section-title">对照规则</h3>
      <dl className="nt-dl">
        <dt>对应表</dt>
        <dd>
          {mapping.versionId} · {mapping.confirmedBy.name}{' '}
          {monthDay(mapping.confirmedAt)} 确认
        </dd>
        <dt>前段标准</dt>
        <dd>
          {standardVersionId}
          {standard ? (
            <div className="nt-muted">
              {standard.reviewPoints
                .map((point) => `${point.title}：${point.description}`)
                .join('；')}
            </div>
          ) : null}
        </dd>
      </dl>
      <table
        className="n-maptable"
        style={{
          width: '100%',
          marginTop: 'var(--s-3)',
          borderCollapse: 'collapse',
          fontSize: 'var(--t-xs)',
        }}
      >
        <thead>
          <tr>
            <th scope="col" style={{ ...th, padding: '4px 0' }}>
              {stage.front}
            </th>
            <th scope="col" style={th}>
              {stage.back}
            </th>
            <th scope="col" style={th}>
              等级
            </th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ borderTop: '1px solid var(--line)' }}>
            <td style={{ padding: '6px 8px 6px 0' }}>{judgmentName}</td>
            <td style={{ paddingRight: 8 }}>{judgmentName}</td>
            <td>{mappingText(mapping)}</td>
          </tr>
        </tbody>
      </table>
      <p className="nt-caption">
        对应表只用于判断对照；改版后，已有的对照保持当时的结果。
      </p>
    </article>
  );
}

/** Raters in the server's name order: no ranking, no rate; under the threshold only 样本不足. */
export function RaterCard({
  raters,
  raterHref,
}: {
  raters: ComparisonHrPage['raters'];
  raterHref: (evaluatorId: string) => string;
}) {
  return (
    <article className="n-card">
      <h3 className="n-section-title">
        按评价人
        <small
          className="nt-muted"
          style={{ fontWeight: 400, marginLeft: 'auto' }}
        >
          按姓名排列
        </small>
      </h3>
      <div>
        {raters.map(({ evaluator, sample }) => (
          <a
            key={evaluator.id}
            className="n-rater"
            href={raterHref(evaluator.id)}
          >
            <Avatar name={evaluator.name} hue={hueOf(evaluator.id)} />
            <b>{evaluator.name}</b>
            {sample.state === 'sufficient_sample' ? (
              <span className="nt-muted">
                {sample.comparableCaseCount} 个案例
              </span>
            ) : (
              <span className="n-rater__few">样本不足</span>
            )}
            <small>{raterLine(sample)}</small>
          </a>
        ))}
      </div>
      <p className="nt-caption">
        可对照案例都计入门槛；偏高、偏低、一致只算前段给了最高或最低一档的判断，中间档只看结营结论的分布。仅
        HR 和评价人本人可见，评价人只看自己的部分。
      </p>
    </article>
  );
}

export function LockNote() {
  return (
    <div className="n-lock">
      <Icon name="lock" />
      对照结论只用于修订人才评价规则。
    </div>
  );
}
