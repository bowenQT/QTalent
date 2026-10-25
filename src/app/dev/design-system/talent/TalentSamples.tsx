'use client';
import { useEffect, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { Anchor } from '@/components/ui/Anchor';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Block } from '@/components/ui/Block';
import { Cite } from '@/components/ui/Cite';
import { EventCard } from '@/components/ui/EventCard';
import { History } from '@/components/ui/History';
import { Icon } from '@/components/ui/Icon';
import {
  JudgeProgress,
  JudgeProgressList,
} from '@/components/ui/JudgeProgress';
import { MatchState } from '@/components/ui/MatchState';
import { MiniQuad } from '@/components/ui/MiniQuad';
import { Score } from '@/components/ui/Score';
import {
  Spectrum,
  type SpectrumDimension,
  type SpectrumEvent,
  type SpectrumGroup,
} from '@/components/ui/Spectrum';
import { Src, srcKinds } from '@/components/ui/Src';
import { StreamText } from '@/components/ui/StreamText';
import { Trail, type TrailStep } from '@/components/ui/Trail';
import styles from './history-sample.module.css';

/** Score row with its revision history opening as a panel right under it. */
function HistorySample() {
  const [open, setOpen] = useState(true);
  return (
    <div className={`n-card ${styles.card}`} data-sample="history-card">
      <b className={styles.title}>修订历史</b>
      <p className={styles.caption}>
        从分数行的「修订历史」展开，嵌在该行下方，最新一次在最上面。
      </p>
      <Score
        dimension="内生动力"
        state="calibrated"
        value={4}
        by="苏晚"
        onOpenHistory={() => setOpen((value) => !value)}
        historyPanel={{ id: 'hist-demo', expanded: open }}
      />
      <History
        id="hist-demo"
        hidden={!open}
        entries={[
          {
            value: 4,
            origin: 'human',
            summary: '改分',
            reason: '两周内三次主动补位，不止这一次。',
            meta: ['苏晚', 'HR 校准', '10-23'],
          },
          {
            value: 3,
            origin: 'human',
            summary: '确认',
            meta: ['叶青', '导师', '10-21'],
          },
          {
            value: 4,
            origin: 'ai',
            summary: 'AI 建议 · 锚点 4 · 引用录音 03:12',
            meta: ['rubric-v1', '10-21'],
          },
        ]}
      />
    </div>
  );
}

const streamSegments = [
  '读取需求，拆出 4 项要求。',
  '在你有权限查看的 38 人中核对证据，3 人的材料已整理完。',
  '周屿的海外客户经验只有简历一处记录，近两年事件里没有，标为证据冲突。',
];

const trailPlan: readonly Omit<TrailStep, 'state'>[] = [
  { id: 'read', label: '读取需求，拆出 4 项要求' },
  {
    id: 'scope',
    label: '检索你有权限查看的 38 人',
    detail: '增长产品部、业务成功部',
  },
  { id: 'check', label: '逐项核对证据' },
  { id: 'draft', label: '生成候选与缺口' },
];

/** Scripted mock: one step per tick; reduced motion shows the finished result at once. */
function StreamDemo() {
  const reduced = useReducedMotion();
  const [tick, setTick] = useState(0);
  const finished = trailPlan.length;
  useEffect(() => {
    if (reduced || tick >= finished) return;
    const timer = setTimeout(() => setTick(tick + 1), 900);
    return () => clearTimeout(timer);
  }, [reduced, tick, finished]);
  const progress = reduced ? finished : tick;
  const steps: TrailStep[] = trailPlan.map((step, index) => ({
    ...step,
    state:
      index < progress ? 'done' : index === progress ? 'active' : 'pending',
  }));
  // Text leads the trail by one segment so the first paragraph and caret show immediately.
  const shown = reduced
    ? streamSegments.length
    : Math.min(progress + 1, streamSegments.length);
  return (
    <div data-sample="stream" className="nt-grid">
      <Trail title="为「海外加速搜索」找 owner · 4 步" steps={steps} />
      <StreamText
        segments={streamSegments.slice(0, shown)}
        streaming={progress < finished}
      />
    </div>
  );
}

const old = (date: string) => date < '10-01';
const event = (
  value: SpectrumEvent['value'],
  dateLabel: string,
  by: string,
  title: string,
): SpectrumEvent => ({ value, dateLabel, by, title, recent: !old(dateLabel) });

const spectrumGroups: readonly SpectrumGroup[] = [
  {
    title: '专业度（对标 N3）',
    dimensions: [
      {
        id: 'prof',
        name: '专业度',
        state: 'scored',
        bins: {
          2: { earlier: 1, recent: 0 },
          3: { earlier: 3, recent: 1 },
          4: { earlier: 1, recent: 2 },
        },
        events: [
          event(4, '10-22', '叶青', '结营评审：接口设计清楚'),
          event(4, '10-16', '周屿', '联调时独立定位缓存问题'),
          event(3, '10-09', '叶青', '搜索接口联调'),
          event(2, '08-30', '宋川', '排查问题靠试错'),
        ],
      },
    ],
  },
  {
    title: '潜力 · 核心',
    dimensions: [
      {
        id: 'mot',
        name: '内生动力',
        state: 'scored',
        bins: {
          3: { earlier: 2, recent: 1 },
          4: { earlier: 5, recent: 3 },
          5: { earlier: 1, recent: 2 },
        },
        events: [
          event(5, '10-22', '叶青', '结营后继续跟进客户反馈'),
          event(4, '10-21', '叶青', '需求变更后主动给出两个备选方案'),
          event(5, '10-12', '苏晚', '周会主动认领没人接的联调文档'),
          event(3, '10-03', '宋川', '有一次等待安排'),
          event(4, '09-18', '叶青', '主动补上测试用例'),
        ],
      },
      {
        id: 'wis',
        name: '智慧力',
        state: 'scored',
        bins: {
          2: { earlier: 1, recent: 1 },
          3: { earlier: 2, recent: 1 },
          4: { earlier: 3, recent: 3 },
          5: { earlier: 0, recent: 1 },
        },
        events: [
          event(4, '10-21', '叶青', '方案对比：结论→依据→取舍'),
          event(2, '10-21', '宋川', '排查问题不够系统'),
          event(5, '10-14', '叶青', '用最小验证路径确认需求'),
          event(3, '09-25', '叶青', '需求拆解偏粗'),
        ],
      },
      {
        id: 'grit',
        name: '坚毅力',
        state: 'insufficient',
        missing: '还没有受挫后如何反应的事件',
      },
    ],
  },
  {
    title: '潜力 · 加分项',
    dimensions: [
      {
        id: 'lead',
        name: '领导力',
        state: 'scored',
        bins: { 3: { earlier: 1, recent: 0 } },
        events: [event(3, '09-20', '叶青', '组内对齐进度')],
      },
      {
        id: 'open',
        name: '开放性',
        state: 'scored',
        bins: { 4: { earlier: 2, recent: 1 }, 5: { earlier: 0, recent: 1 } },
        events: [
          event(5, '10-21', '叶青', '方案被选 B 后迅速调整计划'),
          event(4, '10-12', '叶青', '采纳客户反馈'),
          event(4, '09-19', '苏晚', '借鉴别组的评审做法'),
        ],
      },
    ] satisfies SpectrumDimension[],
  },
];

const anchorLevels = [
  '本次出现与该维度相反的明确行为',
  '相关行为偶发，需要他人推动',
  '常规情境下稳定表现',
  '有难度或模糊的情境下主动表现，并有可见结果',
  '高难情境下突出，并带动他人或形成可复用方法',
] as const;

export function TalentSamples() {
  return (
    <main className="nt-body">
      <h1>人才与 AI 组件</h1>
      <p>来源、分数、引用、事件、能力谱、象限与过程轨迹</p>

      <section className="nt-grid" aria-labelledby="ds-material">
        <h2 id="ds-material">来源与状态</h2>
        <div className="nt-row">
          {srcKinds.map((kind) => (
            <div
              key={kind}
              data-sample={`src-${kind}`}
              style={{ lineHeight: 1.65, fontSize: 'var(--t-sm)' }}
            >
              <Src kind={kind} />
            </div>
          ))}
        </div>
        <div className="nt-row">
          {(['yes', 'no', 'unknown', 'conflict'] as const).map((state) => (
            <div
              key={state}
              data-sample={`match-${state}`}
              style={{ lineHeight: 1.6 }}
            >
              <MatchState state={state} />
            </div>
          ))}
        </div>
        <div className="n-card nt-grid" style={{ maxWidth: 680 }}>
          <div data-sample="score-suggested">
            <Score
              dimension="AI 建议"
              state="suggested"
              value={4}
              note="空心流光，尚未计入档案"
            />
          </div>
          <div data-sample="score-confirmed">
            <Score
              dimension="已确认"
              state="confirmed"
              value={3}
              by="叶青"
              note="实心墨点，署名"
            />
          </div>
          <div data-sample="score-calibrated">
            <Score
              dimension="已校准"
              state="calibrated"
              value={4}
              by="苏晚"
              note="末尾加一个朱点，可展开修订历史"
            />
          </div>
          <div data-sample="score-insufficient">
            <Score
              dimension="资料不足"
              state="insufficient"
              note="涉及但缺少行为或结果，不出分"
            />
          </div>
          <div data-sample="score-absent">
            <Score
              dimension="未体现"
              state="absent"
              note="这件事未体现这个维度"
            />
          </div>
        </div>
      </section>

      <section className="nt-grid" aria-labelledby="ds-process">
        <h2 id="ds-process">输入与过程</h2>
        <div data-sample="trail" style={{ maxWidth: 520 }}>
          <Trail
            title="为「海外加速搜索」找 owner · 3 步"
            steps={[
              { id: 'read', label: '读取需求，拆出 4 项要求', state: 'done' },
              {
                id: 'scope',
                label: '检索你有权限查看的 38 人',
                detail: '增长产品部、业务成功部',
                state: 'done',
              },
              { id: 'check', label: '逐项核对证据', state: 'active' },
              { id: 'draft', label: '生成候选与缺口', state: 'pending' },
            ]}
          />
        </div>
        <div data-sample="trail-failed" style={{ maxWidth: 520 }}>
          <Trail
            title="为「海外加速搜索」找 owner · 第 3 步失败"
            steps={[
              { id: 'read', label: '读取需求，拆出 4 项要求', state: 'done' },
              {
                id: 'scope',
                label: '检索你有权限查看的 38 人',
                detail: '增长产品部、业务成功部',
                state: 'done',
              },
              {
                id: 'check',
                label: '逐项核对证据',
                detail: '失败 · 前两步结果已保留，可重新核对',
                state: 'failed',
              },
              { id: 'draft', label: '生成候选与缺口', state: 'pending' },
            ]}
          />
        </div>
        <StreamDemo />
        <div data-sample="caret">
          <StreamText segments={['正在核对第 3 位候选人的材料']} streaming />
        </div>
      </section>

      <section className="nt-grid" aria-labelledby="ds-progress">
        <h2 id="ds-progress">处理进度</h2>
        <div
          className="n-card"
          data-sample="judge-progress"
          style={{ maxWidth: 520 }}
        >
          <JudgeProgressList>
            <JudgeProgress
              state="queued"
              subject="王一舟"
              note="前面还有 2 位，轮到后自动开始"
            />
            <JudgeProgress
              state="judging"
              subject="周屿"
              note="逐项核对要求 · 2/4"
            />
            <JudgeProgress
              state="review"
              subject="顾南"
              note="「海外客户经验」的证据互相矛盾，等你来定"
            />
            <JudgeProgress
              state="failed"
              subject="宋小满"
              note="判断服务超时，已有证据都保留着"
              retry={{ label: '重新判断', onRetry: () => undefined }}
            />
          </JudgeProgressList>
        </div>
      </section>

      <section className="nt-grid" aria-labelledby="ds-doc">
        <h2 id="ds-doc">活文档与引用</h2>
        <div data-sample="block-ink" style={{ maxWidth: 680 }}>
          <Block authorship="human" signer="叶青" meta="导师 · 10-21 确认">
            需求变更后第二天，林知远带着两个备选方案来找导师，并说明了各自的验收标准
            <Cite
              index={1}
              markLabel="复盘录音"
              access="granted"
              source={{
                kind: 'timestamp',
                title: 'W2 导师团复盘',
                location: '03:12–03:28',
                by: '叶青',
              }}
              quote={
                <>
                  “……知远没等我安排，第二天就拿了 A、B 两个方案过来，
                  <mark>每个方案的验收标准都写清楚了</mark>
                  ，这个我挺意外的。”
                </>
              }
              onPlay={() => undefined}
              jump={{ label: '打开完整纪要', href: '#ds-doc' }}
            />
            。导师选了方案 B，林知远据此重排了剩余任务
            <Cite
              index={2}
              markLabel="周报"
              access="granted"
              source={{
                kind: 'paragraph',
                title: 'Landing W2 周报',
                location: '第 3 段',
              }}
              quote={
                <>
                  剩余任务按方案 B 重新拆分为 5 个 Issue，
                  <mark>原 #14、#15 关闭</mark>。
                </>
              }
            />
            。
          </Block>
        </div>
        <div data-sample="block-light" style={{ maxWidth: 680 }}>
          <Block
            authorship="ai"
            label="AI 建议"
            basis="依据 2 条事件 · 规则 rubric-v1"
          >
            两次复盘都出现「带着假设求助」的行为，可能体现内生动力；但两次都发生在导师在场时，独立情境下的证据还不够。
          </Block>
        </div>
        <p>
          来源受限的引用
          <Cite
            index={3}
            markLabel="来源受限"
            access="locked"
            source={{
              kind: 'paragraph',
              title: '2026 H1 盘点讨论纪要',
              location: '第 4 段',
            }}
            lockedText="这份材料含其他人的管理评价，你只能看到它被引用了，看不到原文。"
          />
        </p>
      </section>

      <section className="nt-grid" aria-labelledby="ds-event">
        <h2 id="ds-event">关键事件与打分</h2>
        <div className="nt-grid" style={{ maxWidth: 760 }}>
          <EventCard
            id="event-sample"
            person={{
              name: '林知远',
              hue: 200,
              photo: 'lin-zhiyuan',
              demo: true,
            }}
            origin="obs"
            dateLabel="10-21"
            recorder="叶青"
            ruleVersion="rubric-v1"
            badges={
              <Badge>
                <Icon name="folder" />
                课题：工单检索
              </Badge>
            }
            title="需求变更后主动给出两个备选方案"
            cites={[
              {
                markLabel: '复盘录音',
                access: 'granted',
                source: {
                  kind: 'timestamp',
                  title: 'W2 导师团复盘',
                  location: '03:12–03:28',
                  by: '叶青',
                },
                quote: '每个方案的验收标准都写清楚了',
              },
            ]}
            sbi={{
              situation:
                'W2 中途，客户反馈搜索结果看不懂内部标识，原方案需要调整。',
              behavior: '第二天带着方案 A、B 找导师，各自写清验收标准与风险。',
              impact: '方案 B 被采纳，林知远把剩余任务重新拆分为 5 个 Issue。',
            }}
            scores={[
              {
                dimension: '智慧力',
                state: 'suggested',
                value: 4,
                note: '锚点 4 · 引用原话「每个都写了验收标准和风险」',
              },
              {
                dimension: '内生动力',
                state: 'confirmed',
                value: 3,
                aiOriginal: 4,
                by: '叶青',
              },
              {
                dimension: '坚毅力',
                state: 'insufficient',
                note: '涉及方案被改，但没写受挫后的反应',
              },
              { dimension: '领导力', state: 'absent' },
            ]}
          />
          <EventCard
            origin="self"
            recorder="林知远"
            title="想试试离客户近一点的工作"
            sbi={{ behavior: '主动提出下个阶段想做售前。' }}
            scoresHidden="本人视角已隐藏维度分"
          />
        </div>
        <div className="nt-grid" style={{ maxWidth: 520 }}>
          <div data-sample="anchor">
            <Anchor
              dimension="智慧力"
              ruleVersion="rubric-v1"
              levels={anchorLevels}
              hit={[4]}
              defaultOpen
            />
          </div>
          <HistorySample />
        </div>
      </section>

      <section className="nt-grid" aria-labelledby="ds-profile">
        <h2 id="ds-profile">个人能力谱与小象限</h2>
        <div data-sample="spectrum">
          <Spectrum
            groups={spectrumGroups}
            header={
              <>
                <div className="n-person">
                  <Avatar
                    name="林知远"
                    hue={200}
                    photo="lin-zhiyuan"
                    size="lg"
                  />
                  <div>
                    <div className="n-person__name">
                      林知远 <Badge className="n-badge--demo">演示</Badge>
                    </div>
                    <div className="n-person__meta">
                      增长产品部 / 业务成功部 · N3 · XEngineer 第六期
                    </div>
                    <div className="n-person__meta">
                      近 12 个月 · 已确认 39 条事件分 · rubric-v1
                    </div>
                  </div>
                </div>
                <MiniQuad
                  calibrations={[
                    { label: 'W2', quadrant: 'll', x: 0.23, y: 0.9 },
                    { label: '结营', quadrant: 'hl', x: 0.33, y: 0.33 },
                  ]}
                  reference={{
                    state: 'placed',
                    quadrant: 'hl',
                    x: 0.36,
                    y: 0.3,
                  }}
                />
              </>
            }
          />
        </div>
        <div className="nt-row">
          <div data-sample="miniquad-empty">
            <MiniQuad calibrations={[]} reference={{ state: 'insufficient' }} />
          </div>
        </div>
      </section>
    </main>
  );
}
