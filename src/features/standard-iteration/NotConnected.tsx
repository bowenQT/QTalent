import { State } from '@/components/ui/State';
import type { ShellData } from '@/contracts/shell';

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

/**
 * The comparison and revision reads (BOW-918/919/921) are not connected yet. The page
 * says so and shows no sample, count or name in their place.
 */
export function JudgeNotConnected({ role }: { role: ShellData['role'] }) {
  const self = role === 'mentor';
  return (
    <>
      <header className="nt-head">
        <div>
          <h1>{self ? '我的判断对照' : '判断对照'}</h1>
        </div>
      </header>
      <State
        title="判断对照待接通"
        text={
          self
            ? '接通后，你作为评价人给出的判断会和结营评审的结论放在一起出现在这里。'
            : '接通后，入营选拔和结营评审的判断会按期次放在一起对照，归因和修订也从这里发起。'
        }
      />
    </>
  );
}

export function StandardNotConnected() {
  return (
    <>
      <header className="nt-head">
        <div>
          <h1>XEngineer 入营选拔标准</h1>
          <p>
            社招面试、入营选拔怎么评，和入职后的维度怎么对照；判断对照以它为准。
          </p>
        </div>
      </header>
      <State
        title="入营选拔标准待接通"
        text="接通后，这里显示生效中的标准、修订草稿、影响预览和确认发布。"
      />
    </>
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
