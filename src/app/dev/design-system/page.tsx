import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Field } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Avatar } from '@/components/ui/Avatar';
import { Niu } from '@/components/brand/Niu';
export default function DesignSystem() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <main className="nt-body">
      <h1>设计系统</h1>
      <p>已移植组件</p>
      <section className="nt-grid n-card" style={{ maxWidth: 680 }}>
        <div data-sample="field">
          <Field label="项目名称" defaultValue="海外加速搜索体验" />
        </div>
        <div data-sample="button" className="nt-row">
          <Button>删除「海外加速搜索体验」</Button>
          <Button disabled>创建中</Button>
        </div>
        <div data-sample="badge" className="nt-row">
          <Badge className="n-badge--yes">
            <Icon name="check" />
            支持
          </Badge>
        </div>
        <div data-sample="avatar">
          <Avatar name="林知远" hue={200} photo="lin-zhiyuan" size="" />
        </div>
        <div className="nt-row">
          {(
            [
              'rest',
              'listening',
              'searching',
              'thinking',
              'done',
              'confirm',
              'error',
            ] as const
          ).map((state) => (
            <Niu key={state} state={state} size={48} />
          ))}
        </div>
      </section>
    </main>
  );
}
