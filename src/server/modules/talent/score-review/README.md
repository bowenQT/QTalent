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
- 真实846保存/操作/撤回/后续处理selector及锁协议。当前846用fragment→event→原件→权限→confirmation/review行锁，不存在旧端口注释所称的共用`score-event`字符串锁；适配时必须与实际锁次序互斥。
- 完整来源图及工作台/待办共享读取窗口。未知事实失败关闭，不能用active数量、任务完成或裸来源图判断可处理。

确认行`reason`可能包含846撤销后重存的版本谱系说明；这不是用户为AI分差提供的评分理由。`ai_gap`缺理由事实须按真实保存输入的action与reason还原，保留原语义，不把谱系文案充作理由。

当前续作另有已合服务换绑重放反例：同账号改绑后旧签署operation错误返回success。反例已登记#248，生产service窗口暂限父批准的一行digest导出，尚未自行扩大修改。此缺陷必须在独立续作中显式修复并审查，不回写或重开已合#268。
