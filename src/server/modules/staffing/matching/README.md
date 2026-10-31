# BOW-854 候选匹配

## 当前提前交付：管理观察排除

基于原 PR head `99d8baa713e61193e202c9f962a94b5374b7b1ee`，普通合入 main `5726fd5d0cd6457d762327829adc002b1dda41b3`。本轮只修匹配资格与相邻测试，不改共享注册、公共出口、合同或迁移。

- 权限允许读取管理观察，不代表它可以参与找人匹配。旧事件的 `EventConfirmationFact.nature=management_observation` 和独立观察的 `management-observation` 投影都排除；有人工确认也不豁免。
- 用例仅接收 evaluation record 的 evaluation SBI 字段。来源自身或完整 `requiredKinds` 含管理观察时，整个引用字段退出匹配；保留原来源的共有人和限制元数据，仍经过当前 `buildAuthorizedModelInput` 授权，不重标来源。
- `createMatchingService` 可以绕过默认 loader 被直接组合，因此在 scope 端口再次过滤性质。读取、人工来源选择和执行旧 run 也排除其已保存的观察，不外发、不显示依赖观察的历史判断。
- 没有合格证据的单元进入 `awaiting_manual`，AI/人工结论保持 null；不变成“不支持”或“资料不足”。有效的已确认事实仍可匹配；混合输入只发送有效事实。
- 固定样例的正常确认事实改为 `original_fact`；同样正文仅改变观察性质的反例必须零模型调用。旧测试中“管理观察进入模型”的断言不再作为产品规则。

本轮验证：五个单测文件 61 项通过，新增十项行为反例先真实 Red（其中纯观察触发4次调用），再 Green。三个改动生产文件的专项行覆盖 298/319（93.41%）、分支239/267（89.51%），85%阈值保持；其中用例文件未执行的真实数据库 loader/runtime 仍留待集成。不是本卡全部11个生产文件或全仓的覆盖率。

验证使用隔离临时 worktree 的精确依赖原 blob：

| 依赖                          | 固定提交                                   | 文件                                           |
| ----------------------------- | ------------------------------------------ | ---------------------------------------------- |
| 原PR已接受的 P0 Source 元数据 | `88ebd4be9ff2de1ac0a0ce9454209afaa8e577ff` | `src/contracts/sources.ts`                     |
| 当前852需求schema             | `9cc28469ef4eaae4e6d369edb620daeb373c51b8` | `src/server/modules/staffing/demand/schema.ts` |

任务分支没有复制这两个文件。原分支 `pnpm typecheck` 仍因 main 缺 Source 的 originalTitle/recordedByName 及 demand/schema 失败，不能拿组合通过替代它。原生 PG、846权威确认/来源adapter、899当前节点授权和迁移/共享接线尚未完成，不能将这些端口测试当成真实应用链。

```sh
pnpm exec vitest run src/server/usecases/staffing-match.test.ts src/server/modules/staffing/matching/eligibility.test.ts src/server/modules/staffing/matching/evidence.test.ts src/server/modules/staffing/matching/storage.test.ts src/server/jobs/staffing-match.test.ts --maxWorkers=2
```

完整卡仍未完成：现有 MatchDependencies 只有 Jev，尚无 Gemini 复核端口；当前逐格串行循环尚未交付10人×4要求的并发策略。不支持结果的复核生命周期、组合质量和总耗时门槛以及真实业务联验要按最新卡补齐，不沿用下方历史“四态全部直接发布”作为最终规则。850的单例真实调用和843的文字/图片验收不能替代这些验收。保持 Draft，未 Ready/关闭。

## 原实现接线资料（历史检查数字不作为本轮结果）

依据：[原卡](https://linear.app/bowenzhong/issue/BOW-854)、
[SDD v0.2 / 独立交叉审](https://linear.app/bowenzhong/document/bow-854-候选匹配-sdd-tdd-v02-ef53cd2dae26)。
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
- `sources`：837 已分类的严格 `Source` 元数据，原件版本/位置/片段必须与授权投影完全一致。按用户指定 PR202@88ebd4be9ff2de1ac0a0ce9454209afaa8e577ff，保留实际 `originalTitle` 和 `recordedByName`；记录人未知时为 `null`，不能拿事件记录人补充来源记录人。模型文字和结论引用都不能从客户端输入补造。
- 当前账号真实 `actor`，须与 context 绑定的人员一致。

用例自身调用 `buildAuthorizedModelInput`，不复制 835 授权算法。
每次读/人工动作的范围为原 run 候选/证据与当前操作者权限的交集；管理者不能把新候选塞入原 run。
业务日期由 `createClock(environment).today()` 生成；任务/署名用单独的真实 `wallNow()`，未使用演示时钟充当安全时间。
固定版二次读取已不可见时返回 `forbidden`；既有 `loadProjectContext` 的 `ForbiddenError` 在用例边界归一为 `MatchingError`，使公开入口安全拒绝，worker 按既有输入失效路径停止。其他数据库/程序异常仍抛出，不吞成权限或四态结论。

## 已实现的最小接线

[staffing-match.ts](../../../usecases/staffing-match.ts) 已提供可调用实现：

- `createStaffingMatchRuntime`：组合 PostgreSQL store、同事务真实 pg-boss enqueue、共享 policy、consumer 注册；构造时不访问数据库、队列或模型。只调用传入的既有 boss getter，不创建 singleton。
- `createStaffingMatchEvidenceLoader`：一次真实 `repeatable read / read only` 事务复用 `loadProjectContext` 和 837 的公开 `readEvidenceForTalent`，再读有效事件确认事实和共用来源投影。
- [assembleMatchingEvidence](./evidence.ts)：把领域读模型组装成最小人物和已确认事件记录；操作者/姓名/组织取真实目录，保留实际项目期次与事实性质，不从评分推断确认。来源使用 837 完整投影，不复制授权算法，不删共同主体。多期次相同身份去重，身份冲突失败关闭。

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
须复用现有 `talent-source-projection`，保留所有同片段事件/参与人/历史敏感分类和原件类别；`details` 逐字对应来源版本、位置与片段，按 PR202 返回真实原件标题及可空的来源记录人姓名。本卡把这两个字段纳入来源身份核对，元数据变更后旧来源不能继续支撑旧结论或人工提交。两者须框架无关，不能把 `queries/person-data.ts` 的 `server-only` runtime 导入 worker。

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

PR130、PR94、PR131 已正式合入；当前正常 append 整合 main dd34dd2，已移除 staffing 合同和 837 三个原 blob 的临时覆盖。剩余固定组合输入为 PR161@e78e5b6788418025b40ddf78bbf5d5adc7eb7f85 的 `demand/schema.ts` 和用户指定 PR202@88ebd4be9ff2de1ac0a0ce9454209afaa8e577ff 的 `contracts/sources.ts` 原 blob；它们只用于独立验证，不作为本卡代码提交。其余 PR202 消费者由父统一协调，不在本卡另造合同/适配或改前端。

Docker PostgreSQL 17 使用本卡新建、无宿主卷的临时容器，随机 loopback 端口和随机 `_test` root 库；测试进一步创建/清理自己的随机 `_test` 库。只使用本次合成账号，无现成业务库或凭据。私有原生组合迁移已实跑真实 pg-boss/事务检查；精确受检 head、统一测试/覆盖与最新 CI 以 PR188 验证记录为准，不把组合结果说成 main 已具备。

### 验证检查点（2026-10-25 UTC）

生产源码 `e41878590b1661cce52fa6af5a6bc277d0460cf6`，另有仅单行 import 格式改动，固定组合 PR161 schema / PR131 三个原 blob 和私有原生迁移：

| 检查                                   | 实际结果                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| `pnpm test:coverage`，含真实 PG        | 109 文件 / 990 测试通过；统一行 97.52% / 分支 95.83%                            |
| 同一覆盖报告中的本卡全部 11 个生产文件 | 行 96.34%（369/383）/ 分支 90.37%（272/301）；语句 94.05% / 函数 94.44%         |
| `pnpm build`                           | 隔离 Linux Node 24.21.0 容器通过，未改标准脚本；宿主 Turbopack 子进程绑定被限制 |
| `pnpm test:e2e`                        | 10/10 通过，包含实际 worker 握手与生产构建样例路由检查                          |
| `pnpm test:visual`                     | 32/32 通过，manifest 451ecec；未修改参照、遮罩、截图基线或原型                  |

覆盖率来自单次单元+真实 PG 全集，不相加百分比、未降低 85% 门槛或扩大排除。Linux 构建使用锁定 pnpm 11.25.0 与锁定 JS 依赖，加载对应平台的同版本原生包：Next SWC 16.4.3、Tailwind Oxide 4.3.3、lightningcss 1.33.0。构建不连接真实服务。

后续整合 main dd34dd2 并适配上述 PR202 来源合同：新增标题/来源记录人变化两项真实 Red，修正来源身份核对后，本卡 **5 文件 / 58 项（含 10 项真实 PG）全部通过**，format/lint/架构边界通过。

另外在独立临时副本应用 **完整 PR202 精确 88ebd4be** 的 10 个原 blob（包括它自带的合同/来源组件测试夹具），与本卡源码 / PR161 schema / 私有原生迁移组合。又实跑复现二次固定版消失、两个上下文端口拒绝及真实 PG 账号缺失共 4 项 Red，修复上述用例授权错误边界后：本卡 **62 项（含 11 项真实 PG）** + PR202 合同 63 项共 **6 文件 / 125 项通过**。专项覆盖显式列出本卡全部 11 个生产文件，保持原 85% 门槛：行 **96.40%（375/389）**、分支 **90.49%（276/305）**，语句 94.14%、函数 94.48%。这是本卡专项报告，不是全工程覆盖报告，未改共享配置。

完整 PR202 组合的全工程 typecheck 阻在 837 的 `talent/derive.ts`（reference bonus）、`queries/person-projection.ts`（评分署名）与 `person*.test.ts`（timeline statement 旧字段）。早先仅 sources 合同的部分组合报夹具缺字段，已由完整 PR202 输入核实消除，不能误记为 PR202 自身未带齐夹具。父已指定 837 集中适配，本卡不重复改它。上表属于前一完整受检检查点，不移植成新合同全工程验收；待父提供集中适配/正式迁移输入后继续统一门禁。

ff065298 的原 CI [40219938655](https://github.com/bowenQT/QTalent/actions/runs/40219938655) 已回读 completed/failure：format/lint/架构边界通过；typecheck 因 main 尚缺 PR202 两个来源字段及 852 demand/schema 失败，后续 PG/coverage/build/e2e/visual 未执行。正式依赖未入当前 PR 时，固定组合通过不替代这个结果。

共享两个 adapter、注册和官方串行迁移需指定 owner 接入后继续验收；一次真实 Jev 仍 Pending。本卡持续在原 PR188 收口，未满足门禁时不标 Done、不合并/部署。
