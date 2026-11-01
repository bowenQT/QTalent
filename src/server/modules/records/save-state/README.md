# 人工保存与撤销账本

`recordDraftEvents` 是草稿当前每人事件映射。`recordSaves`、事件、人工确认与撤销 operation 是历史事实；人工重存不会删除旧保存或复活旧事件。AI 的 `reviseTrustedRecordDraftBatch` 仍拒绝任何已有人工作业历史的批次，包括已撤回历史。

## 撤销完成

`commitRecordUndo` 在现有单次 `advanceDraft` 后将实际 `draftId`、`expectedDraftRevision + 1` 写入 `draftRestoration`，返回仅绑定本次原生事务的 `RecordUndoCommit`。它不额外推进版本，也不根据今天的 draft 猜旧操作版本。

跨域用例执行真实事项取消 CAS 后，调用 `recordUndoCancellationFacts(tx, commit, facts)`。`facts` 必须从 **实际更新返回行** 收集，包含本人 completed→cancelled 和对应撤回事件其他 pending→cancelled 的结果，不得用请求值或锁前 expected 快照拼接。没有取消事项也显式写 `[]`。此口只写当前新撤销账本一次，不提供取消、改派或恢复事项权限，旧操作重放不能获得 fresh commit。

返回值是已剥离内部字段的公共撤销回执，用例据此返回首次响应。`cancelledConfirmationWork` 不属于公开合同。每次读取旧账本时重新投影 `inputRestoration: unavailable`、`originalInput: null`；旧账本缺 `draftRestoration` 只返回 `refresh_required`，不回写、不推历史 revision。

## 人工重存

调用方持有 `lockRecordCommand` 的 batch/draft 锁，在当前权限、来源和事项锁内调用 `readRecordResaveState(tx, lock)`。它只证明 records 域事实：当前映射全部指向该保存真正撤回的事件、撤回时刻和 actor/node/主体一致、同一 undo operation、真实取消事实存在、提交版本等于当前 draft revision。历史缺事实返回 `null`，不会被“状态是 cancelled”替代。

用例必须继续逐项比对 **当前锁内** programs 事项的 id/person/node/assignedRelation/assignedEvaluator/cancelledRevision，并按当前规则重新授权。只有全部匹配，才从本次计划状态排除这些已撤回事件映射、解除本草稿的永久 withdrawn 拒绝，并跳过这些精确 cancelled 事项。不要把它们改回 pending/completed；HR 取消、后续改派、revision 变化和未知历史不能通过。

`commitRecordSave` 再读 records 事实，用旧 eventId 作 CAS 替换当前映射，随后沿原路径推进一次 draft。不存在有效重存事实时，旧映射不会被覆盖。旧 receipt、保存、事件及人工确认历史保持；旧 undo 重放只读旧结果，不能撤销后来新事件。

共享 PG 套件只验证账本、映射、版本和事务边界；真实取消 CAS、当前授权、五秒窗口、跨域评分/复核和循环重存由调用方 native PG 套件共同验收，不能用本域测试替代完整业务验证。
