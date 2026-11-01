# 原生人工记录 ledger 读取

`readLockedRecordLedger(tx, { evaluationNodeId, personId }, { accountId, now })`
及 `NativeRecordLedger` 从 `usecases/record-ledger.ts` 导出。`now` 是可信业务时钟函数，在最后一次数据库等待结束后调用；不是请求内传入的时间。

这是 902、854、849 原生用例的共同**内部事实输入**，不是页面 DTO，也不是“评分就绪”的替代实现。没有新表、迁移或另一份保存状态。基线消费最终 846 与 #316 的完整 intake 来源投影，不包含 #317 的重存恢复规则。

## 事务与写者协议

调用者创建短 `READ COMMITTED` 事务，在持有事件/复核行锁之前调用。函数依次取得 intake 表 SHARE、原生批次表 EXCLUSIVE，再取得 ledger、来源图、确认与复核表 SHARE。锁保留至调用者事务结束，不在函数返回时释放。

- 现有 846 保存/撤销/修订实际在 intake 后取得批次行锁。EXCLUSIVE 与其 ROW SHARE 冲突，因此读取既等待既有写提交，也阻止新的批次写越过栅栏；不会漏掉读取开始时尚不存在的事件。
- 普通 SELECT 不受 batch EXCLUSIVE 阻止。代价是全局人工记录命令串行化，读取完整来源图；仅用于本期短原生命令，不用于长任务、流式响应、供应商调用或普通档案查询。
- 新 849 native 适配必须先采用同一协议，再锁/修改自己的复核数据。旧纯端口里所谓 `score-event` 锁并不是现有 846 使用的锁，单独使用它不足以互斥。
- intake 在第一道锁后读取，其余事实在最后一道锁后读取。不能传入客户端 `ready` 快照，不能用旧 repeatable-read 快照假装刷新；非 READ COMMITTED 会拒绝。
- **授权不由本函数授予。** 消费用例在同一事务锁定自己的当前账户绑定、主体、完整节点/项目/来源授权后，重读本函数并使用锁后时钟决定写入。任何授权锁等待之后都要重读，不能继续用第一次返回的 context。调用者若在事务内修改 ledger，也必须重读；返回的 revision 只证明本次读取的事实，不是能力令牌。
- 本函数不代替调用者自己的 operation/CAS、目标范围、结论资格、HR 校准签名或审计；这些都在同一个外层事务内完成。失败应回滚，不吞数据库错误。

锁模式依据 [PostgreSQL 显式锁文档](https://www.postgresql.org/docs/current/explicit-locking.html)。不增加 advisory-lock 平台或要求改写既有 846 事务。

## 输出与 availability

每个目标事件保留真实事件、当前 mapping、完整保存与撤回历史、确认和复核行。

- `saves[].proof` 核对真实 save / save operation / actor / accepted draft revision / receipt / 时间，并核对撤回 operation。历史签名人不会因当前账号换绑而被改写成新操作者。
- `confirmations[].ownership` 只在精确保存回执包含该确认、评分人/修改人/确认时间相符、来源确属该事件且状态无矛盾时可用。保留 confirmation ID、evaluator ID、revision、confirmedAt、规则、锚点、active 与来源引用。`unknown` 仍是 unknown；后继 HR 校准记录没有相应原生证明时不会猜出归属。
- `confirmations[].acceptedDecision` 只投影同次已接受 save.input 中该目标人员/维度的 action、value、reason；`confirm` 原本没有 reason 字段时保持没有，不拿确认行的撤销/重存谱系 reason 代替。`suggestion` 核对真实 suggestionId、event/dimension/rule/source 与已保存草稿建议的值、锚点、引用和原始 rationale，只返回该项原AI行及建议，不输出整份原输入。
- `reviews[].ownership` 核对真实 save、确认与回执归属；保留 open/resolved/withdrawn 原状态。`resolved` 本身不代表已获 HR 签名，也不代表全员到齐。
- `sources` 复用同一 `talentSources` 完整图与**所有 intake**，包括其他创建者、被 supersede 的输入、撤回事件和共同主体。缺证返回 unavailable。可用只表示来源事实完整，仍须对每个共同主体和 requiredKinds 做当前权限判断，再进入模型。
- `nature` 只返回实际保存的 statement kind 与署名事实。当前原生 846 保存不自动产生 statement；此时明确 `nature_not_recorded`。不能从 `sourceCategory=original`、AI 归因、任务完成或确认数量猜测 nature。
- `revision` 是这些目标事实的 SHA-256 摘要，用于本次事务中的对比；不是数据库递增版本或权限。空事件集合不代表“全员已评价”。

因此 902 的具体节点资格/完整维度门槛，854 的确认事件与 nature 规则，849 的当前 HR 复核权和正式校准持久化，仍由各自原生用例实现。此 reader 不宣告三卡完成。

## 验证

专属 PG 测试使用正式迁移和真实 `saveRecordDraft` / `undoRecordSave`，涵盖事务等待后的新增事件、撤回、复核状态；持锁消费期间禁止并发写，回滚释放；同事务写后重读；未知 nature、遗留/损坏归属、账号换绑、完整共同主体和旧 intake 限制。并发测试通过 `pg_stat_activity` / `pg_locks` 观察真实锁等待，不靠固定 sleep 推测互斥。
