import { State } from '@/components/ui/State';
import { BackLink } from '@/features/sources/BackLink';

/** 原件不存在与超出查看范围用同一个页面，对外不可区分，也不出现原件内容。 */
export default function SourceNotFound() {
  return (
    <State
      title="原件链接失效"
      text="可能已删除，链接有误，或超出你的查看范围。返回上一页重新进入。"
    >
      <BackLink />
    </State>
  );
}
