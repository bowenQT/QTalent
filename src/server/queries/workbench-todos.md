# BOW-863：已登记工作事项的真实读取

`readWorkbenchTodoSources(db, accountId, now)` 从当前数据库读取账号绑定、有效授权、节点关系和 `programs_evaluation_work_items`，同一只读 repeatable-read 事务内完成投影。调用者必须由服务器会话解析账号和时钟；浏览器不传角色、授权、事项列表或计数。

本入口读取已登记的工作事项来源，未接公共 Web 查询。返回服务器内部最小任务身份、版本和 `handle` / `reassign` 动作，不含原文、引用、评分、候选人列表或前任评价人资料。公共页面仍走既有 shell/workbench 合同，后续由 X1 接线。

## 已实现

- 本人可处理事项复用 `canWorkOnEvaluationItem`；HR 待重新分派复用 `canManageNodeAssignments` 与 `assignedEvaluationHandlerIsCurrent`。只读当前 pending/processing；不是“能看这个人就能处理所有任务”。
- 完成、取消、关系到期、撤权、账号换绑、重新分派后，下次读取重新计算。真实完成/重分派事务的回归覆盖这些变化；读取不修改任何账本。
- 原生同源身份是 `(evaluationNodeId, personId, kind, resourceId)`。相同任务只计一次；同人多个任务不能被合并。相同身份出现不同版本/分派/状态则失败，不任意选一条。
- manager 返回 `not_applicable`，没有数量或事项；管理员和无有效业务角色拒绝。HR 与导师只拿自己当前可处理或有权重新分派的事项。
- 数据库错误直接失败，不转换成空集。没有缓存计数、影子待办表或新迁移。

## 完整待办仍未接通

顶层为 `not_connected`，没有综合 `count`。只有 `registeredWork` 是已验证的真实来源数量。即使其数量为零，也不意味着上游全部已登记：

- `scoreReviews`：849 原生复核的当前授权元数据和有效状态仍需接入；不拿纯 repository port 当真实数据库读取。
- `speakerInventory`：860 的完整人工核对账本与 work item 原子登记/完成、材料当前许可尚需固定生产接口；不能只看 work 表没有 speaker 行就宣称无待核对。
- `nodeCoverage`：当前节点只有身份、种类和期次。尚无可信要求、到期时间、适用性与有效完成事实；不能依据缺记录生成待补，更不能生成负面评价。面试节点不产生待补，真实导入后“已有”须依赖906事实。
- shell/workbench 公共 query 与合同由 X1 唯一改写，盘点草稿数仍未接通。没有前端、主动机器人提醒或供应商调用。

共享需求记录：GitHub #248 评论 6562633824。完整863在这些读取与公共接线、依赖和最终验证齐全前不关闭。

## 验证

基线 main `fe34b6faffcfb2832a1be266a155f0d7d19d69cc`。本片仅四个私有文件，无DDL。真实PG使用仓库正式迁移建立随机隔离 `_test` 库，测试后关闭连接并删除库。测试库凭证仅从 `test-db.env` 进入白名单子进程，先持有本人heavy槽，执行后释放。

- Node24直接运行锁定 Vitest：`node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts src/server/queries/workbench-todos.test.ts src/server/queries/workbench-todos.integration.test.ts --maxWorkers=2 --coverage --coverage.include=src/server/queries/workbench-todos.ts --coverage.reporter=text --coverage.reporter=json-summary`：16 PG + 22 unit = 38/38，0 skip；行100%、分支96.42%。
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`：通过。
- `node node_modules/eslint/bin/eslint.js`（本卡三个TS文件）、`node --import tsx scripts/check-boundaries.ts`、私有文件Prettier：通过。

锁定依赖安装已将所需工具从缓存安装；pnpm 因未批准依赖构建脚本退出非零。本卡未运行 approve-builds、未改安全设置/配置。验证直接执行已安装的锁定 Node 工具，没有执行被忽略的构建脚本；安装产生的未跟踪 workspace 提示文件已删除。完整默认 CI 另以当前 PR head 的实际结果为准。
