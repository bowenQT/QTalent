# WeCom 消息与回执账本

本片承载 909 已冻结的持久事实，不实现 WS 接收器、真实发送、Kodo 归档或另一个模型 producer。现作者 `usecases/wecom/message.ts` 仍是确定消息/回执键和发送计划的唯一规则；不得另算一套规则。

## 消息

`wecomMessages.key` 是 `describeWecomDelivery` 的四元组摘要（scope、botId、senderId、messageId），另有四字段唯一约束。`inputDigest` 保留该描述器指纹；它不证明两个媒体字节相同，字节真实性由实际上传版本与 sha256 证明。

actorAccountId/actorPersonId 与 credentialId/credentialRevision 是本次已验证身份历史，不能当当前授权。每次重放仍由 903 current、directory 和领域权限重新核验，账号换绑不能自动重放旧身份。`revision` 是此账本 CAS，绝不与凭据、批次修订混用。

未核目标时 node/personIds/project/collection 全为 null。目标由可信服务器事实给出，禁止从 sender 或聊天内容猜人员/项目/集合；空人员集合只表示明确未知人的输入，不是全员。`personIds` 是完整已核目标集合，不是模型挑出的归因人。writer 必须保持集合唯一、锁后重新核验完整共同主体与当前节点权限。

`archiveRefs` 只有 partIndex、kind(image/file)、真实 uploadId、originalVersionId、sha256。调用 `wecomArchivedMediaListSchema.parse` 校验（含 partIndex 唯一）；SQL 另外拒绝额外 key、文本、短链、解密 key、头、错误类型及越界。上传/原件版本须从现 873 真实入口读取重验，不凭 JSON 成为可信证据。`collectionId` 当前仅引用，待 873 实际 schema/main 可用再形成真实 FK；不另造集合生命周期。

完成文本 producer 后同事务写 inputId/batchId/jobId 三个引用，不能填假的处理中结果。inputId/jobId 分别有真实 FK；queued 批次尚未物化 `record_draft_batches`，所以不加指向未来草稿行的假 FK。writer 必须对现 arrangeInputs 锁后核 batch/job 一致。外部 Kodo 调用不能被声称与 DB 同事务；用已冻结上传和 producer 的确定操作号恢复，不复制原文/URL/key。

## 回执

`wecomReceiptAttempts` 唯一键为 messageKey+kind+batchId+batchRevision+batchStatus，NULLS NOT DISTINCT。group_ack 的三个 batch 字段必须全 null；private_receipt 全部必填。processing 和 awaiting_confirmation 即使 draft revision 相同也各有回执身份。

先事务提交 reserved，再实际发送；只有可信 ACK 才写 acknowledged/acknowledgedAt。reserved 或 outcome_unknown 可能已经送达，**不得自动重发**。SQL 保存准确状态/ACK时间，是否发送及状态转移须复用现 `planWecomReceiptAttempt` 并以真实行锁/CAS 执行；单纯 schema 不提供恰好一次外部发送保证。

## 迁移与交付边界

正式游标仍 873 → 269，当前无正式编号/SQL/meta。`schema.integration.test.ts` 默认走正式迁移；受控结构验证仅该测试进程可指定 `BOW_909_TEST_MIGRATIONS_DIR` 为当前 schema 原生生成的临时目录，正式可用后退役。真实库测试覆盖唯一键、状态键、FK/缺目标拒绝、归档禁止字段、回执提交前不可见/回滚；未宣称机器人或媒体 producer 已接通。
