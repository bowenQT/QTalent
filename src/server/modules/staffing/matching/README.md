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

## 已实现的最小接线

[staffing-match.ts](../../../usecases/staffing-match.ts) 已提供可调用实现：

- `createStaffingMatchRuntime`：组合 PostgreSQL store、同事务真实 pg-boss enqueue、共享 policy、consumer 注册；构造时不访问数据库、队列或模型。只调用传入的既有 boss getter，不创建 singleton。
- `createStaffingMatchEvidenceLoader`：一次真实 `repeatable read / read only` 事务复用 `loadProjectContext` 和 837 的公开 `readEvidenceForTalent`，再读有效事件确认事实和共用来源投影。
- [assembleMatchingEvidence](./evidence.ts)：把领域读模型组装成最小人物和已确认事件记录；演员/姓名/组织取真实目录，保留实际项目期次与事实性质，不从评分推断确认。来源使用 837 完整投影，不复制授权算法，不删共同主体。多期次相同身份去重，身份冲突失败关闭。

授权文件写者只需在现有组合入口填以下两个 owner adapter；`readConfirmations` 和 `projectSources` 是本卡明确请求的端口名，不冒称它们已在其他模块导出：

```ts
import {
  createStaffingMatchEvidenceLoader,
  createStaffingMatchRuntime,
} from '@/server/usecases/staffing-match';

const loadEvidence = createStaffingMatchEvidenceLoader({
  db,
  readConfirmations, // 846 owner，必须使用当前事件确认状态/明确演示基线
  projectSources, // 837/846 owner，复用框架无关的完整来源投影
});
const ports = {
  db,
  environment: env.APP_ENV,
  demands: demandService, // 852 service.read；job completed 不当确认
  loadEvidence,
  jev: explicitJevClient, // 本轮用 fake；真实服务须另获授权
};
```

846 adapter 的精确类型是 `Parameters<typeof createStaffingMatchEvidenceLoader>[0]['readConfirmations']`：
`(tx: Transaction, data: StaffingMatchEvidenceData) => Promise<EventConfirmationFact[]>`。
`data` 为同一事务实际 `loadProjectContext + readEvidenceForTalent` 结果；确认读取须使用传入 tx。
返回每个有效事件的真实 `recordId/personId/state/active/nature`；人工确认含真实 `id/actorId/confirmedAt`，演示基线显式 `kind=prototype_baseline/id/demo=true`。同一事件不能返回两个有效事实，不编确认时间，不以 active 维度评分或 completed job 代替事件确认。撤销/改回草稿后不再返回有效确认。

837 adapter 的精确类型是 `Parameters<typeof createStaffingMatchEvidenceLoader>[0]['projectSources']`：
`(data: StaffingMatchEvidenceData) => Promise<{sources: TalentSource[]; details: Source[]}>`。
须复用现有 `talent-source-projection`，保留所有同片段事件/参与人/历史敏感分类和原件类别；`details` 逐字对应来源版本、位置与片段。两者须框架无关，不能把 `queries/person-data.ts` 的 `server-only` runtime 导入 worker。

应用组合入口复用 852 的唯一惰性 getter：

```ts
import { getAppJobProducer } from '@/server/platform/jobs/app-runtime';
const appMatching = createStaffingMatchRuntime({
  ...ports,
  boss: getAppJobProducer,
});
// 追加 appMatching.policy 到既有 policy 列表；actions/queries 调用
// appMatching.service.start/read/judge，显式传当前会话账号和 runId。
```

worker 在自己的现有 boss 实例上组合，不能导入上面的 server-only 应用入口：

```ts
const workerMatching = createStaffingMatchRuntime({
  ...ports,
  boss: async (queue) => {
    await existingWorkerBoss.createQueue(queue);
    return existingWorkerBoss;
  },
});
await workerMatching.registerWorker(existingWorkerBoss); // 只注册一次
```

共享 worker/runtime、policy 列表、应用动作、环境和 staffing 总 index 仍由指定单写者修改；本卡已给出实际工厂和受测端口，不要求他们重写业务实现。
公开动作须保留 `runId` 资源上下文和 `stale` 返回；人工 body 继续严格用原合同，不悄悄添加 actor/时间或查询 latest run。

## 存储和迁移

独立 `matching/schema.ts` 声明 `staffing_match_runs` / `staffing_match_operations`；cell 的处理进度、AI、人工结论为独立具名字段，schema 严格验证。run 以 job ID 关联，需求 ID/revision 外键指向 852 不可变版本，操作账本按账号+operationId 唯一。
store 采用 advisory 操作锁与 **job → run** 行锁顺序；run/job/operation/pg-boss enqueue 同事务，失败回滚。模型调用在事务外，回写重新授权并检查 attempt、claim、人工和取消栅栏。

发布迁移顺序由唯一 runner 协调：PR94 已合 → 852 → 846 → 本卡 matching。只提供 schema，不手写 SQL/metadata，不改已合迁移，也不发布私有组合产生的冲突编号。
本机可将已合迁移复制到私有临时目录，使用 Drizzle 原生命令对明确固定依赖和本卡 schema 生成组合迁移；通过测试专用 `BOW854_TEST_MIGRATIONS` 指向该目录。默认和 CI 仍要求正式发布的串行迁移，不跳过迁移、不 db:push、不伪造表。回退代码不删除判断、需求、证据和任务历史。

## 验证边界

固定化名集在 `samples.ts`，四态各一条，均标演示；标签是回归参考，不是业务准确率。
本卡单测使用真实授权投影/状态机和边界 fake，不读 key，不调用真实模型或业务 API。
`store.integration.test.ts` 强制隔离 loopback `_test` PostgreSQL，覆盖同事务真实 pg-boss、重复请求、回滚、人工并发、约束与实际 consumer；缺 `TEST_DATABASE_URL` 失败，不能以 skip/fake 替代。

PR130 合同与 PR94 已正式合入 main，当前不再覆盖 staffing 合同。剩余固定组合输入为 PR161@e78e5b6788418025b40ddf78bbf5d5adc7eb7f85 的 `demand/schema.ts`，以及 PR131@8192dc2cc891cc570eb4f20c437fc82c7a2aca9b 的 `authz/talent.ts`、`records/index.ts`、`records/read.ts` 原 blob；它们只用于独立验证，不作为本卡代码提交。

Docker PostgreSQL 17 使用本卡新建、无宿主卷的临时容器，随机 loopback 端口和随机 `_test` root 库；测试进一步创建/清理自己的随机 `_test` 库。只使用本次合成账号，无现成业务库或凭据。私有原生组合迁移已实跑真实 pg-boss/事务检查；精确受检 head、统一测试/覆盖与最新 CI 以 PR188 验证记录为准，不把组合结果说成 main 已具备。

共享两个 adapter、注册和官方串行迁移需指定 owner 接入后继续验收；一次真实 Jev 仍 Pending。本卡持续在原 PR188 收口，未满足门禁时不标 Done、不合并/部署。
