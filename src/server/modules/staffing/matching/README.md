# BOW-854：逐条四态与不支持复核

本片沿原 PR #188 追加，普通合入 main `27d7da28b887d3e0b8043a7ee3cdd915e67c2d56`，消费已合 852、899 和真实 Modelink 客户端。历史 F6 修复 `71a586b68ad2c54ea8a9a51aa5bd1754663722b2` 的 Claude 通过只覆盖管理观察排除，不代表本轮或整卡通过。

当前是实际私有实现和离线验证；生产确认读取、来源投影、持久迁移和公共接线仍待。没有默认 fake、供应商真实调用或正式联验。

## 并发与发布

每个 run 最多四个 judging 单元，覆盖 Jev 和可选 Gemini 的整个生命周期。四条执行循环在事务外并行调用；claim 在既有 job→run 原生行锁内取得，并统计该 run 全部 judging，所以重复投递不会叠加上限或重复认领同一格。10 人×4 要求是 40 个独立单元，不是 40 个同时请求。不是跨所有 run 的供应商限流平台。

调用前和结果写回均按发起人当前权限重新读取需求、候选和证据，核 attempt、claim、取消和人工决定。数据库异常会等待本次已发任务退出后再返回失败，不能丢掉未等待的 Promise。进程崩溃留下的 judging 不自动重发可能计费的调用；仍须现有显式人工处理，不造通用重试或租约平台。

只有 Jev 的 not_supported 才进入 Gemini 复核。Gemini 收到的是同一份最小输入，复核前再核当前授权、需求版本、证据和 claim；未完成时保持 judging、AI/人工结论为空。

- Gemini 明确同意 not_supported：发布该 AI 结论，并保存实际模型、提示词版本和复核状态。
- 复核分歧、失败、坏结构或未知结果：沿已有 awaiting_manual，结论留空，不自动挑某个模型答案；不把材料不足当反证。
- Gemini 返回后仍核当前权限/来源/版本/取消/人工决定，迟到结果不能覆盖。
- 独立读取端口也验证复核结构；旧 payload 没有复核的不支持隐藏为待人工，不自动补发模型。显式人工结论继续按原合同保留。

`matching/review.ts::createUnsupportedReview(client: ModelinkMaasClient)` 实际调用现有 `generateStructured`，只输出严格四态 schema；模型来自既有 MODELINK_MODEL，提示词版本为 staffing-not-supported-review-v1。保存分类和版本，不保存供应商原文、请求头或请求标识。构造缺复核客户端/端口会失败，不能默认通过。该函数不加载环境或创建资源；生产需显式组合已配置客户端。

私有 MatchCell.review 是持久 JSON 内的可选字段，旧 payload 可读；有字段时严格验证状态/结论/模型/版本一致。没有新增数据库列或更改 schema.ts。AI 不写 humanJudgment，不生成员工总分、百分比或排名；排序仍只按必须项支持数，并保留平局稳定性。

## 当前权限与来源

默认 EvidenceLoader 已改用已合 `loadEvaluationContext`，真实读取评价节点、主体与当前关系；不再使用旧 loadProjectContext 代替节点事实。缺完整节点事实拒绝，人员身份和事件使用实际节点主体归属，未知映射不从项目或期次猜测。调用共享 buildAuthorizedModelInput 及其完整来源规则，不复制授权算法。852 当前/固定版必须一致且是 confirmed，真实 DemandAccessError 转无权限；job 完成不等于需求确认。

保留 F6 的三层管理观察排除：事件确认 nature、record/field/requiredKinds 的模型输入筛选，以及绕 loader 的 service 端口/旧 run 读写。权限可读不等于匹配资格，完整共同主体与限制不剥离。无合格证据零模型调用，保留待人工而不造资料不足或不支持。

## 真实确认读取仍缺

846 固定 #289 `09084000d7d606efe172355844a611616b77c964` 的接口交接见 #248/6557705330：没有可供本卡直接消费的完整 readConfirmations API。

现有 `readRecordConfirmationState(tx, lock)` 是写事务内部状态装配，不是下游授权查询；不能把分数确认、事项完成或草稿 ready 当事件已接受。初始人工保存的 createdEventIds、不可变保存人/时间、撤回等事实已有原生权威来源，但 saveId 不是新造的逐事件确认 ID。事件 nature 仍缺独立权威分类，不默认 original_fact 或 human_conclusion；没有 ledger 的旧事件也不猜确认人/时间。

本片保留以下真实端口需求，未复制保存账本 SQL：

```ts
readConfirmations(tx: Transaction, data: StaffingMatchEvidenceData): Promise<EventConfirmationFact[]>
projectSources(data: StaffingMatchEvidenceData): Promise<{ sources: TalentSource[]; details: Source[] }>
```

前者须由 records 的真实公共只读入口给事件/人员、原始人工接受事实、撤回和证据性质；后者复用共同来源投影，保留全部主体、来源类别、原件版本/位置、真实标题和可空记录人。均不能以客户端 IDs 或 fake 结果当许可。loadEvidence 在一个真实只读 repeatable-read 快照内读取；模型写回再次加载，未声称这个只读事务能锁住未来撤权。

## 精确公共接线请求

本片不改任何 index、worker 注册、schema、package/lock 或迁移。

- X1 在稳定源码窗口导出 `createUnsupportedReview` / `UnsupportedReviewClient`，或在唯一 runtime 内按本片接口组合；当前 `StaffingMatchDependencies.reviewUnsupported` 必填。真实 Modelink 配置从服务端环境来，不在构造函数中自动读取文件。
- 复用现有 852 唯一惰性 producer、jobs policy 和 worker 实例；`createStaffingMatchRuntime` 只提供实际工厂，app/worker 的注册和当前会话 query/action 接线仍由 X1。start/read/judge 保留明确 runId，不能查询 latest run。
- 两张原匹配表为 staffing_match_runs / staffing_match_operations，声明原 blob 未动；数据写入、job、operation 和 pg-boss enqueue 必须同事务。正式及受控验证迁移只由 X1 生成，本会话不手写或生成 DDL，不抢当前 846→845→873 优先链；本卡位置以协调索引游标为准。

## 验证与剩余范围

本轮普通 main 组合下既有五组 61 项通过。新回归先 Red：重复 worker 串行不足、复核前直接发布、分歧/失败仍展示、旧未复核判断泄漏共 5 失败；实际 852 拒绝、缺节点事实与未知事件归属再 3 失败。独立读取接受不一致复核元数据另先 Red 后修复。测试使用合成最小证据，实际调用 Modelink 假传输边界，默认测试不访问网络。

运行实际已安装锁定工具：

```sh
node node_modules/vitest/vitest.mjs run src/server/usecases/staffing-match.test.ts src/server/modules/staffing/matching/eligibility.test.ts src/server/modules/staffing/matching/evidence.test.ts src/server/modules/staffing/matching/storage.test.ts src/server/modules/staffing/matching/execution.test.ts src/server/modules/staffing/matching/review.test.ts src/server/jobs/staffing-match.test.ts --maxWorkers=2
```

覆盖率 include 为全部 matching/*.ts（包括未执行的 store/schema）、本 usecase 和 job，不以只覆盖导入文件掩盖数据库路径。最终数量、比例、SHA 与静态/CI 结果见 PR 对应 head 的证据。未执行真实 PG 时，明确 store/loader/runtime 的原生行为仍待，整体覆盖率达标也不替代它。

现有 PG 集成测试会创建唯一随机 _test 库并清理，但缺已发布匹配表迁移；等待 X1 受控迁移输入，不以跳过/空集/手写 SQL 当通过。测试只按指定受控环境加载 TEST_DATABASE_URL，不输出值；真实PG前先取得 heavy 槽。

一次实际联验仅为方案（#248/6557602808），当前 0 请求：离线/PG先验10×4；真实小样例4×1，最多4次Jev加最多4次Gemini、并发≤4、每服务单次尝试、沿已确认超时，无未知结果重发。实际调用须父协调窗口且真实权限/确认/来源齐，850和843通用调用不替本卡。质量与总耗时门槛尚未定，仅报告实测，不称达标；是否改单 Gemini 由所有者决定。

剩余生产范围精确为 records 确认与nature读取、完整来源adapter、共享 app/worker 接线、原生迁移/PG，以及这一次实际联验和质量/耗时裁定。本片保持 Draft+blocked，不关闭整卡。历史审查后修改1/2不重置，稳定新head更新原Claude请求，不把旧F6通过当新结论。
