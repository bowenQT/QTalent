import { State } from '@/components/ui/State';

/** 人员不存在与超出查看范围用同一个页面，对外不可区分，也不出现姓名。 */
export default function PersonNotFound() {
  return (
    <State
      title="人员链接失效"
      text="可能已删除，链接有误，或超出你的查看范围。回到人才列表重新进入。"
    >
      <a className="n-btn n-btn--sm" href="/people">
        回到人才列表
      </a>
    </State>
  );
}
