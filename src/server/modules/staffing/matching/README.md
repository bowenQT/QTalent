# BOW-854 候选匹配

依据：[原卡](https://linear.app/bowenzhong/issue/BOW-854)、
[SDD v0.2 / 独立交叉审](https://linear.app/bowenzhong/document/bow-854-候选匹配-sdd-tdd-v01-ef53cd2dae26)。
本模块提供匹配核心、PostgreSQL store 与 jobs 工厂；应用入口和共享注册尚待父协调接线。

## 使用边界

`createStaffingMatchUsecase(deps)` 暴露：

- `start(accountId, {operationId, demandId, expectedRevision})`：只接受当前已人工确认的需求版本。生成任务完成不等于确认。返回独立 `runId` 和共享任务快照。
- `read(accountId, runId)`：重新授权投影；需求版本变化返回 `stale` 元数据，不返回旧候选。
- `judge(accountId, runId, input)`：body 使用现有 `humanStaffingJudgmentInputSchema`；`runId` 是明确的资源上下文，必须由动作/路由继续传递，绝不查询 latest run。署名取服务端当前人员，时间为真实 wall clock。每格人工结论只追加一次；AI 保留，人工用于展示和排序。
- `execute(runId, attempt)`：worker 始终用 run 发起人的当前授权。每格持久 claim 后只调用一次 Jev；重复 delivery 不重新调用已 claim 的格。中断后保留 judging，显式人工判断，不盲目重发可能计费的请求。
- `project(accountId, run)`：给共享 job policy 使用的当前授权投影，不打开第二个 matching store 事务。

每个候选 × 要求单次调用 Jev。零条已确认/已授权证据、供应商异常/超时/坏输出都进入 `awaiting_manual`，AI/人工结论留空。脱敏错误类别只在内部 cell 保存，不记录原始异常、模型正文或 confidence。
Jev 只返回四态：展示来源是**完整实际输入**，程序说明不冒充模型解释或模型选出的引文。
固定输入组织版本 `staffing-match-input-v1` 与 Jev 提示词版本随 run 保存。

候选按现有 `orderStaffingCandidates` 的必须项支持数量稳定排序；不输出总分或百分比。
AI 已完成后的人工作为 canonical cell 追加；原 job 处理结果保留。待人工 job 的人工完成经同事务 `resume → running → awaiting_manual/completed`，不 enqueue 模型。
取消优先于待人工/失败态的提前返回；迟到模型结果不能覆盖人工、取消或过期版本。

## 可信端口：复用 852 / 837 / 846

`demands.read` 直接使用 852 的 `service.read(accountId, demandId, revision?)`。
用例先读当前版、再显式读固定版，严格确认 `status=confirmed`。旧 run 明确过期，重算须显式 start。
不声称两个 read 提供跨域行锁；保存的判断始终绑定不可变需求版本，读取和提交前均复核。

`loadEvidence(accountId, today)` 返回 `StaffingMatchDependencies` 中的：

- 当前授权 context、完整共同主体/来源分类的原始 `LoadTalentSnapshot`。从 837 的 person-data / 846 的 talent-source-projection 复用；不能过滤掉同片段的其他主体后再构造来源。
- 人物 record：`kind=person`，受授权的 `name` / `orgName` 原子字段。用例只投影这两个字段，不从事件文本猜身份或组织。
- 事件 record：真实 event ID，`kind=evaluation` 或 `management-observation`，有 `behavior`；`situation` / `impact` 可缺省，空 situation 合法。字段须保留完整来源限制，AI 字段不进入输入。
- `confirmations`：来自 **事件确认权威** 的有效确认事实，包含 recordId/personId/state/active/nature；人工事实携带真实确认 ID、人员和时间。已确认演示基线显式 `prototype_baseline` / `demo=true`，不编历史确认时间。不能用“有 active 维度评分”替代事件确认。
- `sources`：837 已分类的严格 `Source` 元数据，原件版本/位置/片段必须与授权投影完全一致。模型文字和结论引用都不能从客户端输入补造。
- 当前账号真实 `actor`，须与 context 绑定的人员一致。

用例自身调用 `buildAuthorizedModelInput`，不复制 835 授权算法。
每次读/人工动作的范围为原 run 候选/证据与当前操作者权限的交集；管理者不能把新候选塞入原 run。
业务日期由 `createClock(environment).today()` 生成；任务/署名用单独的真实 `wallNow()`，未使用演示时钟充当安全时间。

## 父协调接线片段

以下片段放在**获准的组合入口**；本 PR 不改共享 index、worker/runtime、环境或 852 的惰性 producer。
`loadConfirmedMatchingEvidence` 是上述现有数据 owner 提供的适配端口，当前未注册，不能视作已有实现。

```ts
import { sql } from 'drizzle-orm';
import { fromDrizzle } from 'pg-boss';
import { getAppJobProducer } from '@/server/platform/jobs/app-runtime';
import {
  createPostgresMatchStore,
  loadMatchRun,
} from '@/server/modules/staffing/matching';
import { createStaffingMatchUsecase } from '@/server/usecases/staffing-match';
import {
  staffingMatchQueue,
  staffingMatchJobPolicy,
  registerStaffingMatch,
} from '@/server/jobs/staffing-match';

const enqueueMatch = async (tx: Transaction, job: JobRecord) => {
  const boss = await getAppJobProducer(staffingMatchQueue);
  const id = await boss.send(
    staffingMatchQueue,
    { jobId: job.jobId, attempt: job.attempt },
    { db: fromDrizzle(tx, sql) },
  );
  if (!id) throw new Error('Matching enqueue rejected');
};
const matching = createStaffingMatchUsecase({
  environment: getEnv().APP_ENV,
  store: createPostgresMatchStore(db, enqueueMatch),
  demands: demandService, // 852 read，不使用生成job的completed标记
  loadEvidence: loadConfirmedMatchingEvidence,
  jev: explicitJevClient, // 测试用fake；真实client只在获准组合时显式选择
});
const policy = staffingMatchJobPolicy({
  loadRun: loadMatchRun,
  project: matching.project,
  enqueue: enqueueMatch,
});
// 将 policy 追加到既有共享 policy 列表；只注册一次。
await registerStaffingMatch(existingWorkerBoss, matching.execute);
```

worker 需要框架无关的证据适配端口；不能从 `queries/person-data.ts` 的 `server-only` 入口直接导入。
先复用 owner 已抽出的来源投影，不在本卡复制完整查询或新建 singleton。
公开 actions/queries 还需按已确认合同映射 start/read 的 runId/stale 资源上下文；本 PR 没有私自增加前端合同字段或开放动作。

## 存储和迁移

独立 `matching/schema.ts` 声明 `staffing_match_runs` / `staffing_match_operations`；cell 的处理进度、AI、人工结论为独立具名字段，schema 严格验证。run 以 job ID 关联，需求 ID/revision 外键指向 852 不可变版本，操作账本按账号+operationId 唯一。
store 采用 advisory 操作锁与 **job → run** 行锁顺序；run/job/operation/pg-boss enqueue 同事务，失败回滚。模型调用在事务外，回写重新授权并检查 attempt、claim、人工和取消栅栏。

迁移顺序由父协调：PR94 → 852 demand → 本卡 matching。只提供 schema，不手写 SQL/metadata，不改已合迁移。
父原生生成并应用迁移后再执行真实 PG 测试。回退代码不删除判断、需求、证据和任务历史。

## 验证边界

固定化名集在 `samples.ts`，四态各一条，均标演示；标签是回归参考，不是业务准确率。
本卡单测使用真实授权投影/状态机和边界 fake，不读 key，不调用真实模型或业务 API。
`store.integration.test.ts` 强制隔离 loopback `_test` PostgreSQL，覆盖同事务真实 pg-boss、重复请求、回滚、人工并发、约束与实际 consumer；缺 `TEST_DATABASE_URL` 失败，不能以 skip/fake 替代。

开始实现时临时组合 PR130@209739ed、852@e78e5b6、jobs@8fd71c0；这些依赖 blob 不作为本卡提交。PR94 后续已合 main，最终基线和实际检查以 PR188 当前 head 的验证记录为准。
本地最终组合的额外输入只有：PR130@209739edb5b35966c5b1a5c71bc9a8ce3e0bbd30 的 `src/contracts/staffing.ts`、PR161@e78e5b6788418025b40ddf78bbf5d5adc7eb7f85 的 `demand/schema.ts`、PR131@8192dc2cc891cc570eb4f20c437fc82c7a2aca9b 的 `authz/talent.ts`（原 snapshot_field 支持）。它们只在独立 checkout 临时取原 blob，验证后还原；本卡没有提交依赖复制或修改授权算法。
837 完整来源/事件确认适配、共享接线、父串行迁移、当前 head 完整 CI 和一次真实 Jev 验收仍是门禁。未满足时保持 Draft，使用 `Refs #46 / Part of BOW-854`，不标 Done，不合并/部署。
