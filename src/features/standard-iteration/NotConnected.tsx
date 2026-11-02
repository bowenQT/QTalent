import { State } from '@/components/ui/State';

const adminText = '系统管理员负责账号与权限、北森同步、集成配置和审计日志。';

/** Admins see the generic business-view notice, as on /projects and /work. */
export function AdminNotice() {
  return (
    <State title="这一页属于业务视角" text={adminText}>
      <a className="n-btn n-btn--sm" href="/admin">
        打开系统管理
      </a>
    </State>
  );
}

export function RulesDenied() {
  return (
    <State
      title="人才评价规则由 HR 和管理者维护"
      text="修订由 HR 起草、管理者确认发布。你作为评价人的判断在「我的判断对照」里。"
    >
      <a className="n-btn n-btn--sm" href="/judge?rater=me">
        打开我的判断对照
      </a>
    </State>
  );
}

/** No XEngineer selection standard is in force yet, so there is nothing to show or revise. */
export function StandardNone() {
  return (
    <State
      title="还没有生效的入营选拔标准"
      text="第一版入营选拔标准发布后，这里会显示正在生效的版本和要点。"
    />
  );
}
