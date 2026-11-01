# AgentAPI 原生持久结构（BOW-915）

三表承接既有 `usecases/agentapi` 服务的会话、轮次与工具回执。它们保存签发时的身份比较事实和真实执行状态，不代表当前读写权限，也不创建实际渠道凭据。

- `agentApiConversations` 保存签发 account/person/credential/revision/digest；binding 删除时仅置空引用，保留历史，后续动作必须拒绝失效绑定。
- `agentApiTurns` 以 conversation/operation 为键。ordinal 与 provider user-event 在会话内唯一；每个会话至多一个未完成轮次。`failed`、`reserved` 和 `outcome_unknown` 都不能据此自动重发。
- `agentApiToolEvents` 绑定实际 turn；服务端 business-operation 全局唯一，result-event 在会话内唯一。SQL 校验必要身份、对象和类型；native writer 仍须按工具名解析完整 input/output 契约，并拒绝同 ID 不同事实。

## 原生 writer 接入边界

直接从本目录 `schema.ts` 导入三张实际表。后续 writer 在调用方事务中锁会话，锁等待后重读全部 turn/tool、当前 903 绑定、directory account/person 和 899 权限，验证状态迁移与所有将披露的来源。业务动作、审计与回执必须同事务提交。供应商 I/O 在事务外，返回后再次核验当前身份及权限。表结构不能替代以上逻辑；本交付尚未实现 native store 或生产工厂。

工具成功结果严格沿用既有服务的 `Buffer.byteLength(JSON.stringify({ status: 'success', payload })) <= 65536`。native writer 必须复用同一紧凑 wire 检查，超限抛出并使调用方整个事务回滚。JSONB 展示文本会插入空格，不能用 `octet_length(jsonb::text)` 代替该限制；SQL 不另加会缩窄合法输入域的字节限制。回答正文沿用既有字符上限，与工具结果 wire 字节上限区分。

## 验证与正式迁移

`schema.integration.test.ts` 默认运行正式迁移并真实访问三表；缺表即失败，不 mock 或 skip。仅结构接入阶段可显式提供 `BOW_915_TEST_MIGRATIONS_DIR`，指向从当前全量 schema 由 Drizzle 原生生成的受控临时目录。目录必须保留正式迁移和 metadata 原字节；不得手写替代 DDL。既有入口回归使用其原有 `BOW_903_TEST_MIGRATIONS_DIR`，两者在本次组合指向同一个受控目录。

本次真实验证：19 项三表 PG、15 项既有入口 PG、89 项既有 AgentAPI 单测，共 123 项通过。覆盖外层事务不可见与回滚、并发 turn 唯一约束、未知结果阻止下一轮、会话删除后历史保留、跨 turn 关联拒绝、必要 JSON 字段 fail-closed、精确 64 KiB 合法 wire 入库及既有 auth 行升级保真。服务原有超限拒绝回归仍通过；native writer 的完整事务验收须在实现后另跑。

正式 SQL 未在本窗口生成或提交。当前基线正式 `0000–0009` 未变；临时目录额外包含该基线尚未正式迁移的 903 三表、审计字段以及 915 三表，不可冒称仅本卡正式迁移。最终须按共享迁移游标串行生成，退役临时覆盖后以默认 CI 验证。结构测试通过不等于本卡 Ready、供应商实测或生产链路完成。
