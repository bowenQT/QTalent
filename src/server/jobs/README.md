# 任务进度快照（BOW-842，部分交付）

依据：[已交叉审 Spec v0.2](https://linear.app/bowenzhong/document/8583e151484e)。短轮询读取完整、已授权、已校验的持久快照，不是模型 token stream，不提供 SSE / WebSocket / 历史事件回放。

## 接入边界

- GET `/api/jobs/{jobId}` 经 `queries/jobs.ts`；POST 同一路径经 `actions/jobs.ts`。POST 必须同源，body 含 `jobId`、`action`（retry / resume / cancel）、`operationId`、`expectedRevision`。会话来自服务端请求头，响应 `no-store, private`，错误不返回内部堆栈。
- `createJobSnapshotSchema(kind, strictResultSchema)` 由消费者组合明确的结果白名单。未知状态/字段/负计数拒绝。消费者负责对嵌套结果也使用 strict schema，不允许 unknown / 任意 JSON；内部持久 result 不等于公共 DTO。
- 消费者在 `JobPolicy` 实现独立 read / retry / resume / cancel 权限，按当前账号×动作×范围×用途重新验证。已读取或任务创建者不是写许可。`project` 必须先逐主体过滤，再计算可见计数；来源引用等业务合同由消费者维护，jobs 不反向导入人才/来源契约。
- 当前 production 仅注册 `test-job` 的合成示例：按现有 project read 权限读取；所有控制动作拒绝。它不是人才结论，也不引入新业务写权限。未注册 kind 默认拒绝。真实消费者控制、输入版本、人工前置条件和授权投影仍待对应业务卡接入。
- `JobStore` 用 PostgreSQL 行锁串行化同一任务。控制、操作账本和 `policy.enqueue` 必须在传入的同一事务上执行。pg-boss 提供 `fromDrizzle(tx, sql)` 适配器；不能在 callback 内另开连接。相同 operationId 先检查当前权限，再重放原操作结果；同键不同语义冲突。
- worker 使用 `commitJobUpdate`，提供具体结果 schema。attempt / revision / cancel fence 和业务写入在同一事务中检查/提交；校验失败不提交业务。此入口不能保证外部供应商撤回，只阻止取消后结果写入本地业务。
- `insertJob(tx, record)` 仅供已有授权的业务 usecase 调用。创建快照和首次 pg-boss send 也应在同一事务提交，不暴露任意创建任务的公共 API。

## 状态与订阅

- queued → running → partial（可重复），running / partial → awaiting_manual / failed / completed。
- awaiting_manual 只能显式授权 resume，attempt 不变；failed 只能显式授权 retry，attempt 加一、进度结果错误清空；completed / cancelled 不恢复。
- cancel 接受后持久写 cancelRequestedAt，不另加 cancelling 状态，不删除来源或既有事实。worker 安全停机后写 cancelled；已经 cancelled 的重复 cancel 不重复副作用。
- `subscribeToJob` 一次一个请求，成功每 1 秒读取，故障按 2 / 4 / 8 秒退避；网络超时是连接错误，不改成任务 failed。终态/失败/待人工停止自动读取，但待取消确认仍读取。
- 对当前订阅调用 refresh，可在 resume / retry 后重新读取；401 / 403 清空并终止，重新登录须创建新订阅。页面切换/退出登录应 unsubscribe 并清理页面持有的状态。unsubscribe 只停止读取，不取消服务端任务。
- 浏览器传入 `{ online: window, visibility: document }` lifecycle，恢复网络/重新可见立即读取；卸载时移除监听。无需 localStorage，不跨账号缓存。

## 合成示例与测试

`progress-worker.ts` 注册独立 pg-boss `progress-example` 队列，payload `{ jobId, attempt }`。它将已存在的 test-job 快照依次写 running / partial / completed；只产生标为演示的合成单元，没有真实人才数据或外部副作用。生产 worker 已注册该队列；无创建页面，无未经授权的 enqueue HTTP 后门。

- 单元测试覆盖契约、状态机、严格投影、当前权限、控制幂等、取消/完成、HTTP边界、订阅单请求/退避/乱序/撤权与生命周期。
- `snapshots.integration.test.ts` 使用隔离真实 PostgreSQL + pg-boss：HTTP→query/action→policy→事务，持久快照重连、并发retry只入队一次、enqueue失败全事务回滚、取消栅栏阻止业务写入、完成先赢后cancel冲突及数据库约束。
- 集成测试只替换会话、Access、Next请求上下文边界；控制策略为测试显式注册的合成策略，不是production新增授权。
- `pnpm test` 不是完整验收。统一覆盖须 `pnpm test:coverage`，浏览器/视觉另报。真实 Cloudflare Tunnel + Access 验收未运行，离线CI不能替代。

## 迁移与交付顺序

本分支按当前 main 独立生成 jobs 迁移。合入必须在 BOW-834 之后，先基于最新 main 重新生成迁移及 metadata，再重复完整验证；不得同时合并或覆盖834迁移。迁移只新增任务快照/操作账本；回退代码不等于删除持久数据，不提供自动清理或破坏性down migration。

本卡保持部分交付关联：Refs #34 / Part of BOW-842。依赖、消费者联调与真实隧道验收未完成前不把整张卡关闭，不宣称业务端到端完成。
