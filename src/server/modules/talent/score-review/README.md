# BOW-849 · 两类 HR 评分复核的提前实现

冻结输入为 main `dc53fbe54179281b5bee37877aba7795eea3a4d1` 中已合入 BOW-844 的 `review-queue.ts` / `record.ts`。仅实现 `rater_gap` 与 `ai_gap`，`recalibration` 保持 `not_connected`。`keep_score` 只用于 AI 分差条目，保留人工分时同样要求理由；这与第三类「保持正式位置」无关。

## 已实现的独立逻辑

- HR 身份由服务端端口获取，管理员和其他角色拒绝；每条先核评价节点与被评价人范围，再装配双方分数和来源。没有旧期次授权回退。
- 当前来源/字段权限检查在返回队列与每次重放前执行。缺少可读证据的条目不向无权者透露；数据库故障仍抛出，不变成空队列。
- 两种双方数据通过844契约解析。署名、时间和原规则版本来自服务端，不接受客户端冒签；选分必须找到原版本、原维度、目标值的真实锚点。
- 新 HR 校准保留双方原分和证据，合并去重引用。AI 仍是建议，HR 新签名与原人工确认分开。当前投影更新不生成档案版本、不写正式位置。
- 同一 actor/action/operation 的语义指纹重放；同键异义冲突；不同键重复解决同一条目或旧 revision 冲突。操作锁先于与846共用的事件锁，等待后重新检查权限；已解决条目的重放也不跳过当前范围和来源检查。
- `CalibrationWrite` 一次传出新记录、原记录摘要、范围、预期版本和操作回执，要求适配器在同一真实事务中持久化并更新队列/待办。当前提供的是调用顺序与计划，不是数据库事务实现。

`queries/score-review.ts` 是显式依赖注入的 server-only 组合接缝。`request.ts` 只是领域组合辅助；未创建无法接通的 Next server action，也没有默认/fake 运行时、路由、全局注册或前端接线。正式 action 须由X1接入真实899/846端口后再提供。

## X1 / 后续写入会话必须接的部分

1. 公共出口：talent/index.ts 导出 service 的读取/解决入口、ports 中类型及错误；查询改消费该公共出口。作者没有修改共享index。
2. 899：服务端当前账号与 HR 身份；事件的当前 evaluationNodeId + personId 范围；已撤销/过期/跨节点拒绝；两位署名人、AI建议和所有引用的当前权限及真实性。`authorizedItem` 必须指向精确的确认/建议版本，不能临时挑任意两份有效分数。
3. 846：沿用精确 confirmationId / counterpartConfirmationId / suggestionId / saveId / withdrawnAt。main 的 scoreReviews 目前只有事件、维度、reason/status，缺少这些关系与版本，不能可靠还原双方。最终 schema/迁移由X1随既定顺序整合，不新增影子生命周期或手写迁移。
4. 持久化：保存新HR校准与不可变原始双方、操作者与服务器时间；当前有效确认遵守 event+dimension+evaluator 的唯一键及版本链，不 upsert 覆盖历史。review 的 revision/CAS、每条唯一处理、操作回执 actor+action+operation 唯一和语义指纹、审计、当前投影、review/todo关闭须同事务。队列/待办应读取同一有效关闭状态。846撤销须识别后续HR处理并冲突，不能撤回校准结果。
5. 899最新交接96fa3aa已实证等锁前Serializable快照会忽略撤权：写适配器须Read Committed配操作/事件锁，锁后重载授权与业务时钟，不能传旧页面/worker上下文。真实PG验证后才能声称事务/持久唯一性成立；再接服务器query/action、工作台和待办，并验证处理后刷新/重启仍消失。当前没有真实PG适配器或数据库操作回执表，纯端口假实现的并发与回滚不能替代这些检查。

## 验证边界

定向测试覆盖角色/范围/来源拒绝、冻结版本锚点、必填理由、保留原分、不同语义与旧版本冲突、重放撤权、串行端口测试替身下的并发和回滚、原始证据与冻结状态保留。所有输入均为合成演示。

```sh
pnpm exec vitest run src/server/modules/talent/score-review --maxWorkers=2 --coverage --coverage.include='src/server/modules/talent/score-review/*.ts' --coverage.include='src/server/queries/score-review.ts'
```

不运行真实供应商、部署或生产数据操作。#38（846）与899、共享schema/持久适配器、PG联验未完成前保持Draft/待整合，不据端口测试通过关闭849或宣称实际待办已接通。

## 已合独立片后的原生续作

当前基线为实际main `fe34b6faffcfb2832a1be266a155f0d7d19d69cc`，#268已合入。上面的旧字段缺口描述仅为历史：846已在现`scoreReviews`保存精确saveId、confirmationId、counterpartConfirmationId及withdrawnAt，也已真实生成两类差值复核。不能把旧说明解读为当前完全没有入队或确认关系。

新增`usecases/score-review.ts`读取真实899当前账号和HR范围；复核与事件身份以数据库原生行交叉核对，先过滤目标元数据，再由后续reader装配双方和证据。HR自己的noReview不阻止履职；被评价对象的noReview仍按899拒绝。目标处于另一节点、另一人员或另一版本时不借客户端字段或其他评价关系授权。换绑、撤权、过期、review/event撤回均重新读取；resolved不在待处理元数据列表，但合法旧操作仍可进行当前范围检查。该结果没有review revision、原始双方或来源许可，不是可直接展示/处理的ReviewItem。

20项真实PG验证上述当前身份、元数据过滤及失败传播；使用正式迁移和化名隔离库，结束删除。没有以这些测试证明校准写入、完整来源权限、待办关闭或完整生产服务。

原生适配仍须X1提供：

- `scoreReviews`修订栅栏、不可变HR校准与原始双方快照、账号/operation幂等回执的受控结构。现有表尚不能承载完整校准；不临时把评分放在审计文本或内存JSON中。
- 评分当前投影的唯一消费方式。不能简单新增第三位评价人的active分，却让原双方继续作为未校准候选或生成新分差。
- 已普通消费X1真实ledger固定`c73d5c5fc53fa2c09da806e0789ffdb48134a3dd`：`readLockedRecordLedger`提供短事务全局写栅栏与原生保存/撤回/复核事实，不存在旧端口注释所称的共用`score-event`字符串锁。849仍须在同事务锁定当前完整权限后重读，尚未把此事实函数接成校准store。当前返回缺少原保存action/reason和原AI suggestion行，ai_gap不能猜补。
- 完整来源图及工作台/待办共享读取窗口。未知事实失败关闭，不能用active数量、任务完成或裸来源图判断可处理。

确认行`reason`可能包含846撤销后重存的版本谱系说明；这不是用户为AI分差提供的评分理由。`ai_gap`缺理由事实须按真实保存输入的action与reason还原，保留原语义，不把谱系文案充作理由。

已合服务的换绑重放缺陷已拆为独立安全修复#319（固定`1ea8469cbb8a612be736a3bb57509838fb1b6086`），本续作普通消费。18个等待期间换绑、撤权和范围收回反例在旧main失败，修复后63项通过；旧署名回执保持，合法新HR仍可做新操作。此处与云端校准写计划校验组合114项通过，仍不代表原生校准事务完成。`digest`仅由本续作导出供纯校验复用，独立修复PR不含此导出。

固定ledger组合验证为151/151（849的114项unit、20项范围PG，加X1实际ledger的17项PG），类型通过。共享输入23文件未改，私有净diff仍原7文件。X1校准结构/投影最小提案已登记#248/6562723052；该提案尚非已执行DDL或已完成存储。


### 原生写入进行中（尚待结构联验）

已普通消费X1 `ca0ea8759b217e9841cb656c0948af631adadec0`，真实acceptedDecision与绑定AI原始事实已到，不再猜取确认行的谱系理由。私有`postgres.ts`按正式冻结6562785414提供不可变校准/原签名回执、review revision CAS、同savepoint操作账本与审计；原确认行保持，不插第三rater。

`resolveNativeScoreReview`已在本卡usecase组合真实ledger写栅栏、完整当前权限关系锁、锁后重读、既有projectTalentRecord完整共同主体与requiredKinds策略、原保存用户理由和旧规则锚点，再调用现服务与私有store。未接公开route；当前有效评分/工作台公共消费仍由X1接线。

新增PG代码以实际846双评价人saveRecordDraft制造两类review，验证持久CAS/回滚/原分保全/精确FK，以及原生命令重放、换绑、撤权和共同主体拒绝。共享schema/受控迁移尚未到，新增PG尚未执行，当前type仅剩冻结表/列不存在；不得沿用前述151项作为这批新代码的通过证据。测试允许X1已核定的BOW849_TEST_MIGRATIONS目录，缺结构明确失败，无CREATE TABLE/skip兜底。
