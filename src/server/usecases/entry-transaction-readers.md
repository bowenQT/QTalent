# 入口消费的同事务领域读取

调用方已建立真实事务后，可使用以下现有工厂上的读取方法；没有另一套 SQL 或权限系统。

- `createDemandService(...).readInTransaction(tx, accountId, demandId, revision?)`：每次重新取完整时钟与当前 context，验证项目读取资格，再加载指定版本或 root.currentRevision 并解析合同。没有当前版本返回 null，不回退历史，不把队列回执当需求成品。原 `read` 包装同一实现。
- `createRecordBatchArrangeRequests(...).readBatchInTransaction(tx, accountId, raw)`：调用方使用 Read Committed；严格批次输入验证、当前创建者与唯一未被替代 input、真实 job 行锁、锁等待后重新定位，再复用原生 authorization/input/receipt。原 `readBatch` 使用显式 Read Committed 包装。此入口只读取现有原生文本批次；不新增媒体可用性，不接受缓存 actor 或 receipt，不调用模型。

事务属于调用方，两方法均不提交、另开事务或从池读取本次事实。领域写入与入口 receipt/审计需要一致性时必须传同一真实事务；外部供应商 I/O 不能跨该事务。915 的会话锁与当前903身份验证仍由其组合负责。

本次固定 d44 基线组合实际跑过 92 项真实 PG：新增需求8、批次12，以及原生需求/文本创建与同事务写入72。批次等锁用 pg_blocking_pids 确认真实竞争，不靠 sleep。需求测试按真实 FK 和日期撤权列构造失败事实，未改变生产权限或时间语义。当前全 type、范围 lint/format、boundary 通过；未声称默认全 CI 或915整链完成。

临时 PG 目录由当前 schema 经 Drizzle 原生生成，仅用于隔离结构验证，未提交正式 SQL/meta。正式迁移依旧遵守共享游标。实际消费者必须核匹配 manifest；不合并915表或后续媒体源码到本读取交付。
