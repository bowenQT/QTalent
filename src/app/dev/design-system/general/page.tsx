import { notFound } from 'next/navigation';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Check } from '@/components/ui/Check';
import { Icon } from '@/components/ui/Icon';
import { Peek } from '@/components/ui/Peek';
import { PersonRow } from '@/components/ui/PersonRow';
import { Select } from '@/components/ui/Select';
import { Fail, Lock, State } from '@/components/ui/State';
import { Tabs } from '@/components/ui/Tabs';
import { Textarea } from '@/components/ui/Textarea';
import {
  ChipsSample,
  DialogSamples,
  PeekSamples,
  SegMenuSample,
  ToastSample,
} from './GeneralInteractive';
export default function GeneralSamples() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <main className="nt-body">
      {/* 与原型设计系统页的内容栏同宽，成组样张的栅格才会折行一致 */}
      <div style={{ maxWidth: 1040 }}>
        <h1>通用组件</h1>
        <p>BOW-831 · 与原型 Y 设计系统页的通用控件、反馈与状态、速览逐项对照</p>
        <h2>徽标</h2>
        {/* 原型里这些徽标出现在表格与列表里，继承 1.6 的行高 */}
        <section className="nt-row" style={{ lineHeight: 1.6 }}>
          <Badge tone="yes" icon="check" data-sample="badge-yes">
            支持
          </Badge>
          <Badge tone="no" icon="x" data-sample="badge-no">
            不支持
          </Badge>
          <Badge tone="unknown" icon="dash" data-sample="badge-unknown">
            资料不足
          </Badge>
          <Badge tone="conflict" icon="split" data-sample="badge-conflict">
            证据冲突
          </Badge>
          <Badge tone="ai" icon="spark" data-sample="badge-ai">
            待核对
          </Badge>
          <Badge tone="seal" data-sample="badge-seal">
            待确认
          </Badge>
          <Badge tone="demo" data-sample="badge-demo">
            演示
          </Badge>
          <Badge tone="preset" data-sample="badge-preset">
            预先处理的演示任务
          </Badge>
          <Badge tone="recal" data-sample="badge-recal">
            可能需要重新校准
          </Badge>
          <Badge tone="prep">筹备中</Badge>
          <Badge tone="ended">已结束</Badge>
          <Badge tone="archived" icon="archive">
            已归档
          </Badge>
        </section>
        <h2>表单控件</h2>
        <section className="nt-grid" style={{ maxWidth: 480 }}>
          <div data-sample="select">
            <Select label="项目类型">
              <option>业务项目</option>
              <option>XEngineer 课题</option>
              <option>训练营课题</option>
              <option>黑客松</option>
              <option>专项</option>
            </Select>
          </div>
          <div data-sample="textarea-error">
            <Textarea
              label="校准理由"
              note="必填"
              placeholder="写一句为什么这样校准"
              error="校准分数需要写理由，原分和原评分人会一起保留。"
            />
          </div>
          <div data-sample="textarea">
            <Textarea
              label="补充说明"
              hint="选填，写给之后复盘的人看。"
              placeholder="写一句背景"
            />
          </div>
          <div data-sample="check">
            <Check defaultChecked>保存后通知项目 owner</Check>
          </div>
        </section>
        <h2>页签、分段控件、筛选与菜单</h2>
        <section className="nt-grid" style={{ maxWidth: 520 }}>
          <div data-sample="tabs">
            <Tabs
              label="记录视图"
              items={[
                {
                  id: 'notes',
                  label: '纪要',
                  content: (
                    <p className="nt-muted">
                      标签页切换同一对象的不同视图；左右方向键可以切换。
                    </p>
                  ),
                },
                {
                  id: 'text',
                  label: '文字记录',
                  content: (
                    <p className="nt-muted">带说话人和时间点的逐句记录。</p>
                  ),
                },
                {
                  id: 'check',
                  label: '待核对',
                  count: 2,
                  content: (
                    <p className="nt-muted">2 处人名指代需要你选一下。</p>
                  ),
                },
              ]}
            />
          </div>
          <SegMenuSample />
          <ChipsSample />
        </section>
        <h2>弹窗</h2>
        <DialogSamples />
        <h2>速览</h2>
        <PeekSamples />
        <div data-sample="peek" style={{ maxWidth: 420, marginTop: 16 }}>
          <Peek demo open label="速览样张">
            <header className="n-peek__head">
              <Avatar name="林知远" hue={200} photo="lin-zhiyuan" size="lg" />
              <div>
                <h2>林知远</h2>
                <p>业务成功部 · 初级产品架构师 · 入职 3 个月</p>
              </div>
            </header>
            <div className="n-peek__acts">
              <button
                className="n-btn n-btn--sm n-follow"
                type="button"
                aria-pressed="false"
              >
                <Icon name="star" />
                加关注
              </button>
            </div>
            <section className="n-peek__sec">
              <h3>为什么值得关注</h3>
              <div className="n-peek__why">
                <span className="n-watch__cat">突出表现</span>
                叶青推荐适合做
                FDE：联调时能独立定位跨域问题，也会主动接没人认领的联调文档
                <span className="n-cite">
                  <button
                    className="n-cite__mark"
                    type="button"
                    aria-label="引用 1"
                  >
                    1
                  </button>
                </span>
                <span className="n-cite">
                  <button
                    className="n-cite__mark"
                    type="button"
                    aria-label="引用 2"
                  >
                    2
                  </button>
                </span>
              </div>
              <p className="n-peek__src">叶青推荐 · 苏晚核实 · 也命中 N1</p>
              <p className="n-peek__rule">
                规则 T2：负责人、导师 / 助教或 HR 的提名与推荐，经 HR 核实 ·
                watch-v2
              </p>
            </section>
            <section className="n-peek__sec">
              <h3>
                关键事实
                <a className="n-link" href="#general-peek">
                  查看全部
                </a>
              </h3>
              <ol className="n-peek__facts">
                <li>
                  <span className="n-peek__date">10-15</span>
                  <span>
                    客户现场演示后调整搜索结果的展示方式
                    <small>海外加速搜索体验 · 周屿记录</small>
                  </span>
                </li>
                <li>
                  <span className="n-peek__date">10-12</span>
                  <span>
                    周会主动认领没人接的联调文档
                    <small>韩策记录</small>
                  </span>
                </li>
              </ol>
            </section>
            <section className="n-peek__sec">
              <h3>能力线索</h3>
              <ul className="n-peek__caps">
                <li>
                  <b>内生动力</b>
                  <span>2 件事</span>
                  <small>
                    高难情境下表现突出，并带动他人或形成可复用的方法
                  </small>
                </li>
                <li>
                  <b>智慧力</b>
                  <span>1 件事</span>
                  <small>常规情境下稳定表现出该维度的行为</small>
                </li>
              </ul>
              <p>其余 2 个维度资料不足，不代表能力低。</p>
            </section>
            <section className="n-peek__sec">
              <h3>已经在做的事</h3>
              <ul className="n-peek__doing">
                <li>叶青在重点跟踪 · 11-02 回看</li>
              </ul>
            </section>
            <footer className="n-peek__foot">
              <button className="n-btn n-btn--sm" type="button">
                <Icon name="pen" />
                记一件事
              </button>
              <a className="n-btn n-btn--sm n-btn--ink" href="#general-peek">
                打开档案
              </a>
            </footer>
          </Peek>
        </div>
        <h2>人员行</h2>
        <section
          data-sample="person-rows"
          style={{
            maxWidth: 520,
            padding: 'var(--s-3)',
            borderRadius: 'var(--r-sheet)',
            background: 'var(--sheet)',
            boxShadow: 'var(--e-1)',
          }}
        >
          <PersonRow
            avatar={
              <Avatar name="林知远" hue={200} photo="lin-zhiyuan" size="" />
            }
            name="林知远"
            nameAfter={<Badge tone="demo">演示</Badge>}
            meta="业务成功部 · 初级产品架构师 · 2 个项目"
            trailing={
              <Badge
                style={{ background: 'var(--q-hl)', color: 'var(--q-hl-ink)' }}
              >
                高潜待练
              </Badge>
            }
          />
          <PersonRow
            avatar={<Avatar name="陈一禾" hue={150} size="" />}
            name="陈一禾"
            nameAfter={<Badge tone="demo">演示</Badge>}
            meta="员工视角下，看不到象限与分数"
            trailing={<Lock>仅本人资料</Lock>}
          />
        </section>
        <h2>反馈：撤销提示</h2>
        <ToastSample />
        <h2>状态</h2>
        <section
          data-sample="states"
          style={{
            display: 'grid',
            gap: 'var(--s-4)',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          }}
        >
          <State
            kind="loading"
            card
            title="正在检索"
            text="在你有权限查看的 38 人中核对证据。"
          />
          <State
            kind="empty"
            card
            title="关键事件会出现在这里"
            text="说一句最近做的事，或者上传一段复盘录音。"
          >
            <Button className="n-btn--sm n-btn--ink">记录第一条</Button>
          </State>
          <State
            kind="failed"
            card
            title="转写没有完成"
            text="第 3 段音频上传中断。已完成的 2 段保留着，可以只重传这一段。"
          >
            <Button className="n-btn--sm">
              <Icon name="retry" />
              重传第 3 段
            </Button>
          </State>
          <State
            kind="denied"
            card
            title="这部分资料在你的查看范围之外"
            text="盘点结论仅管理者和相关 HR 可见。需要的话，请联系苏晚。"
          />
        </section>
        <h2>AI 与来源出问题时</h2>
        <section className="nt-cols">
          <div data-sample="fail">
            <Fail
              title="Jev 的判断暂未生成"
              kept="已保留：周屿相关事件 4 条 · 简历第 2 段"
              actions={
                <>
                  <Button className="n-btn--sm">
                    <Icon name="retry" />
                    重新判断
                  </Button>
                  <Button className="n-btn--sm n-btn--ghost">我自己判断</Button>
                </>
              }
            >
              「有海外客户经验」这一项还没有判断结果。证据已经整理好，不受影响。
            </Fail>
          </div>
          <Card>
            <p className="nt-muted">卡片只是容器，不含业务字段。</p>
          </Card>
        </section>
      </div>
    </main>
  );
}
