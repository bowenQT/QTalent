# 媒体人审核对的原生事实

本目录承接同一 `records_arrange_inputs` 的媒体文件子集，不新增批次或进度主表。`materials` 的 inputId/inputVersion 外键固定其输入版本，原件与上传集合仍从873读；digest、解析版本和位置仍从873/926读。

- `mediaMaterials` 保存材料身份与初次完整范围事实；范围未知时 `intakeScope`、`scopeAuditId` 同为 null，不从创建者、AI归属或上传时间补值。已知范围必须有实际捕获审计，且不代表以后仍有权限。后续人审不覆盖初次事实。
- `mediaReviewItems` 保存原问题以及当前 revision/state/currentOperationId。原问题中的候选名单、source、旧 state/revision 不构成当前授权或状态；当前已解决投影必须从精确操作构建并重新核撤销条件。
- `mediaReviewOperations` 保存账号与当时绑定人员、操作键、原命令、不可变回执、真实 auditId、精确受影响事项版本集合。恢复阶段沿回执的实际 resume，不另造持久能力。撤销引用原操作，不覆盖原操作。
- `mediaReviewDraftDependencies` 由生产者同事务登记实际 operation/item/draft/revision，不按人员或片段推断。历史草稿版本不外键到会变化的当前 revision；因此后续 CAS 不会被历史依赖阻断。

结构不是授权实现。写入方仍必须在统一锁序下验证：材料与上传真实配对、同批当前成员、节点与完整共同主体/类别、当前 actor 绑定、实际操作影响集合、来源及草稿版本、确认或导入截止条件。所有历史 released 成员应完整读出，不能套本次 files 的10项上限截断。

当前验证只覆盖四关系的数据库身份、约束及事务。原始输入媒体变体已单独定义，但输入表、内部保存 writer、来源读取、producer 和 worker 的媒体分支尚待同窗口接入；没有生产可用承诺，没有公共空导出。未知来源不进入模型。人工补采集流程尚待所有者选择，不把结构注释变成全材料强制确认。

正式迁移遵守873→269游标。本目录 PG 测试默认使用正式迁移；本机受控组合可显式传 `QTALENT_MEDIA_TEST_MIGRATIONS` 指向 Drizzle 原生生成的临时目录，SQL/meta 不进仓库。临时结构通过不等于默认正式CI通过。
