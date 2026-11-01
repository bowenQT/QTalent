import { State } from '@/components/ui/State';
import { ShellTitle } from '@/features/shell/ShellTitle';

/** 缺批次、批次不存在或不属于当前账号用同一个页面，对外不可区分，也不出现批次内容。 */
export default function ReceiptNotFound() {
  return (
    <>
      <ShellTitle title="回执" />
      <State
        title="回执链接失效"
        text="可能已删除，或链接有误。回到工作台，从「进行中的任务」重新进入。"
      >
        <a className="n-btn n-btn--sm" href="/work">
          回到工作台
        </a>
      </State>
    </>
  );
}
