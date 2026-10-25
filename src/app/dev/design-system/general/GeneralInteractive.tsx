'use client';
import { useRef, useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chips } from '@/components/ui/Chips';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Icon } from '@/components/ui/Icon';
import { Menu } from '@/components/ui/Menu';
import { Peek, usePeek } from '@/components/ui/Peek';
import { Seg } from '@/components/ui/Seg';
import { Textarea } from '@/components/ui/Textarea';
import { ToastProvider, useToast } from '@/components/ui/Toast';
const changeTypes = [
  { value: 'all', label: '全部' },
  { value: 'trend', label: '能力走向' },
  { value: 'activity', label: '活跃度与安排' },
  { value: 'quad', label: '象限变化' },
  { value: 'team', label: '团队分布' },
];
/** 筛选项：这个样张是单选；多选时由调用方改成增减。 */
export function ChipsSample() {
  const [selected, setSelected] = useState(['all']);
  return (
    <div data-sample="chips">
      <Chips
        label="按类型筛选"
        items={changeTypes}
        selected={selected}
        onSelect={(value) => setSelected([value])}
      />
    </div>
  );
}
export function SegMenuSample() {
  const [asking, setAsking] = useState(false);
  const [view, setView] = useState<'recent' | 'version'>('recent');
  return (
    <>
      <div className="nt-row" style={{ justifyContent: 'space-between' }}>
        <div data-sample="seg">
          <Seg
            label="比较基准"
            size="md"
            value={view}
            onValueChange={setView}
            items={[
              { value: 'recent', label: '近 3 个月' },
              { value: 'version', label: '上一档案版本' },
            ]}
          />
        </div>
        <div data-sample="menu">
          <Menu
            trigger={
              <Button
                className="n-btn--icon n-btn--ghost"
                aria-label="更多操作"
              >
                <Icon name="more" />
              </Button>
            }
            entries={[
              {
                id: 'edit',
                label: '编辑项目',
                icon: 'pen',
                onSelect: () => {},
              },
              {
                id: 'archive',
                label: '归档',
                icon: 'archive',
                onSelect: () => {},
              },
              'separator',
              {
                id: 'delete',
                label: '删除项目',
                icon: 'x',
                danger: true,
                onSelect: () => setAsking(true),
              },
            ]}
          />
        </div>
      </div>
      <DeleteDialog open={asking} onOpenChange={setAsking} />
    </>
  );
}
function DeleteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="改为归档？"
      description="事件和方案引用了这个项目，归档能保留这些记录的出处。归档后，成员、事件和方案都保留，项目移到「已归档」。"
      facts={['关联事件 6 条', '已确认方案 1 个（v2，10-20）']}
      actions={[
        {
          id: 'cancel',
          label: '取消',
          variant: 'ghost',
          onSelect: () => onOpenChange(false),
        },
        {
          id: 'archive',
          label: '改为归档',
          variant: 'ink',
          icon: 'archive',
          onSelect: () => onOpenChange(false),
        },
      ]}
    />
  );
}
export function DialogSamples() {
  const [dialog, setDialog] = useState<'delete' | 'freeze' | 'return' | null>(
    null,
  );
  const close = (open: boolean) => {
    if (!open) setDialog(null);
  };
  return (
    <>
      <div className="nt-row">
        <Button data-sample="open-delete" onClick={() => setDialog('delete')}>
          删除「海外加速搜索体验」
        </Button>
        <Button
          className="n-btn--seal"
          data-sample="open-freeze"
          onClick={() => setDialog('freeze')}
        >
          确认 v3 并冻结
        </Button>
        <Button data-sample="open-return" onClick={() => setDialog('return')}>
          退回这次修订
        </Button>
      </div>
      <DeleteDialog open={dialog === 'delete'} onOpenChange={close} />
      <ConfirmDialog
        open={dialog === 'freeze'}
        onOpenChange={close}
        title="确认方案 v3"
        description="确认后会冻结这一版的人员范围、主要依据、人工结论和后续行动。之后再改会生成 v4，v3 原样保留。"
        facts={[
          '涉及 3 人，都在你的授权范围内',
          '后续行动 2 项，进入行动列表',
          '确认不等于任命已经执行',
        ]}
        actions={[
          {
            id: 'cancel',
            label: '取消',
            variant: 'ghost',
            onSelect: () => setDialog(null),
          },
          {
            id: 'freeze',
            label: '确认并冻结',
            variant: 'seal',
            onSelect: () => setDialog(null),
          },
        ]}
      />
      <ConfirmDialog
        open={dialog === 'return'}
        onOpenChange={close}
        title="退回这次修订？"
        actions={[
          {
            id: 'cancel',
            label: '取消',
            variant: 'ghost',
            onSelect: () => setDialog(null),
          },
          {
            id: 'return',
            label: '退回',
            variant: 'ink',
            validate: (root) =>
              root.querySelector('textarea')?.value.trim() !== '',
            onSelect: () => setDialog(null),
          },
        ]}
      >
        <Textarea label="退回理由" note="必填" />
      </ConfirmDialog>
    </>
  );
}
const peekPeople = {
  'p:lin': {
    name: '林知远',
    meta: '业务成功部 · 初级产品架构师 · 入职 3 个月',
  },
  'p:zhou': { name: '周屿', meta: '增长产品部 · 高级后端工程师' },
} as const;
/** 速览抽屉：点名字拉起，再点同一个名字关闭，点另一个名字直接切换。 */
export function PeekSamples() {
  const peek = usePeek();
  const person = peek.openKey
    ? peekPeople[peek.openKey as keyof typeof peekPeople]
    : null;
  return (
    <>
      <div className="nt-row">
        {(
          [
            ['p:lin', '林知远'],
            ['p:zhou', '周屿'],
          ] as const
        ).map(([key, name]) => (
          <a
            key={key}
            className="nt-plink"
            href={`#${key}`}
            {...peek.triggerProps(key)}
          >
            {name}
          </a>
        ))}
        <span className="nt-muted">⌘ / Ctrl 点击照常打开详情页</span>
      </div>
      <Peek
        open={peek.open}
        onClose={peek.close}
        labelledBy="peek-sample-title"
        contentKey={peek.openKey}
      >
        <header className="n-peek__head">
          <Avatar name={person?.name ?? ''} hue={200} size="lg" />
          <div>
            <h2 id="peek-sample-title">{person?.name}</h2>
            <p>{person?.meta}</p>
          </div>
        </header>
        <footer className="n-peek__foot">
          <Button className="n-btn--sm">
            <Icon name="pen" />
            记一件事
          </Button>
        </footer>
      </Peek>
    </>
  );
}
function ToastButtons() {
  const toast = useToast();
  const failedOnce = useRef(false);
  return (
    <div className="nt-row">
      <Button
        className="n-btn--sm"
        data-sample="toast-run"
        onClick={() =>
          toast.show('已保存到 林知远 的档案', {
            onUndo: () => undefined,
            undoneText: '已撤销，记录没有保存',
          })
        }
      >
        保存一条记录
      </Button>
      <Button
        className="n-btn--sm"
        onClick={() => {
          failedOnce.current = false;
          toast.show('已保存到 周屿 的档案', {
            onUndo: async () => {
              await new Promise((resolve) => setTimeout(resolve, 600));
              if (!failedOnce.current) {
                failedOnce.current = true;
                throw new Error('simulated');
              }
            },
            failedText: '撤销没有成功，记录仍然有效',
          });
        }}
      >
        保存一条记录（第一次撤销会失败）
      </Button>
      <Button className="n-btn--sm" onClick={() => toast.show('已复制链接')}>
        普通提示
      </Button>
    </div>
  );
}
export function ToastSample() {
  return (
    <ToastProvider>
      <ToastButtons />
    </ToastProvider>
  );
}
