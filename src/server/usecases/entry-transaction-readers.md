# 入口消费的同事务领域读取

调用方已建立真实事务后，可使用以下现有工厂上的读取方法；没有另一套 SQL 或权限系统。

- `createRecordBatchArrangeRequests(...).readBatchInTransaction(tx, accountId, raw)`：调用方使用 Read Committed。严格校验批次输入后，先取 intake SHARE 锁，再按当前创建者定位唯一未被替代的 input、取真实 job 行锁，之后重新定位，再复用原生 authorization/input/receipt。锁顺序与 runner 和提交路径一致（先 intake，再 job 行）：同一事务里先调 `createInTransaction`（已持 intake 写锁）再调本方法不会和 runner 成环。反过来先读后建不行：读取只持 SHARE，随后 `createInTransaction` 要把它升级为写锁，会被同时持 SHARE、正等 job 行的 runner 挡住而成环。同一事务既要建批次又要读批次时，先建后读；只读不建时没有限制。原 `readBatch` 是显式 Read Committed 的包装。只读取现有原生文本批次，不新增媒体可用性，不接受缓存的 actor 或 receipt，不调用模型。

事务属于调用方：方法不提交、不另开事务，也不从连接池读取本次事实。领域写入与入口 receipt/审计需要一致时必须传同一个事务；外部供应商 I/O 不能跨这个事务。915 的会话锁与 903 身份核验仍由入口组合负责。

批次等锁的测试用 `pg_blocking_pids` 确认真实竞争，不靠 sleep。
