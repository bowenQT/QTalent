# BOW-846 → BOW-845 原生来源确认续作

本窗口从 main `71f8d9d` 普通组合已完成的 #289 `1a431c3` 与 #185 `271f268`，组合点 `6e4b49e`。不修改 #289 的最终 R2；其原始输入恢复仍明确 unavailable。本窗口承接先前登记的生产接线缺口，不增加重新生成用户动作。

## 来源与当前权限

新文本在人工确认前只有原件、版本、片段和真实 intake；不能为了读取来源先插一条 event。确认读取把所有匹配 intake 的 sourceContexts 与完整正式 event/history 关系合并，保留其他主体、节点和 requiredKinds，包括旧 intake 的限制。创建账号、选择人员、AI 的 personIds 或 attributedPersonIds 都不是完整来源主体证明。

只接已存在的原生文本生产事实：batch/node/boundAt/occurredOn、唯一 inputSource、原件类型、准确片段定位、原始字节摘要及 canonical RecordInput 文本须一致。RecordInput 按合同去掉外围空白，原件片段和摘要仍保留原始字节。没有实际接入的附件/录音不能默认成文本或空来源。既有正式图若包含不能解释的关联，intake 不能把它补成“完整”。

合并后的事实继续交既有 resolveRecordSourceFacts 和确认领域规则校验。每次首次保存、重放、撤销都重新加载当前服务端身份/节点权限，逐主体检查主 kind 与每个 requiredKind；不把整理时的创建者权限缓存成当前确认权限。

## 事务边界

intake 的 JSON 来源没有片段外键，锁已有行不能排除并发插入的另一份共享 intake。确认事务先取 arrangeInputs 的 SHARE 表锁，再锁 batch/draft、正式来源图和当前权限；不在 batch 锁后取得 input 行锁。表锁只在当前事务持有，允许并行确认读取，阻止 intake DML；代价是短暂串行化 intake 写入。所有来源读取在锁定后发生，等待另一个 intake 提交后必须重新读取。

正式 source graph 仍用原有外键父行锁，不改变其授权算法。真实 PG 测试验证等待中的 SHARE 锁以及对刚提交扩大主体的拒绝，不用时间等待代替锁证据。

## 确认后的回执

846 人工保存会推进 draft revision；历史 AI 快照不会改写。845 回执须验证 save receipt 的 revision = 历史快照 revision + 1 且不大于当前 draft revision，并核对除 revision 外的 AI 内容完全相同。不能要求旧快照版本等于当前版本，也不能删除历史来消除差异。

## 仍需完整交付的依赖

- X1：records/write.ts 的稳定 ID / expected batch 与 draft revision CAS、已人工保存栅栏、公共出口；不由本用例生成 SQL。
- 845：正式迁移与唯一 worker 注册。临时结构只可用于明确标记的合成 PG 验证，不能代替默认 CI。
- 内部修订：只消费已存在 generation=revise 合同，不新增用户入口。跨模型等待须核真实 job attempt/revision/cancel，最终通过同一事务保存。
- 完整当前 head 回归、正式 CI、跨工具审查与 X1 门禁全部完成后才能称此后继 PR Ready。
