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
