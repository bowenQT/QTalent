# 媒体人审核对的原生事实

本目录承接同一 `records_arrange_inputs` 的媒体文件子集，不新增批次或进度主表。`materials` 的 inputId/inputVersion 外键固定其输入版本，原件与上传集合仍从873读；digest、解析版本和位置仍从873/926读。

- `mediaMaterials` 保存材料身份与初次完整范围事实；范围未知时 `intakeScope`、`scopeAuditId` 同为 null，不从创建者、AI归属或上传时间补值。已知范围必须有实际捕获审计，且不代表以后仍有权限。后续人审不覆盖初次事实。
- `mediaReviewItems` 保存原问题以及当前 revision/state/currentOperationId。原问题中的候选名单、source、旧 state/revision 不构成当前授权或状态；当前已解决投影必须从精确操作构建并重新核撤销条件。
- `mediaReviewOperations` 保存账号与当时绑定人员、操作键、原命令、不可变回执、真实 auditId、精确受影响事项版本集合。恢复阶段沿回执的实际 resume，不另造持久能力。撤销引用原操作，不覆盖原操作。
- `mediaReviewDraftDependencies` 由生产者同事务登记实际 operation/item/draft/revision，不按人员或片段推断。历史草稿版本不外键到会变化的当前 revision；因此后续 CAS 不会被历史依赖阻断。

结构不是授权实现。写入方仍必须在统一锁序下验证：材料与上传真实配对、同批当前成员、节点与完整共同主体/类别、当前 actor 绑定、实际操作影响集合、来源及草稿版本、确认或导入截止条件。所有历史 released 成员应完整读出，不能套本次 files 的10项上限截断。

`readMediaReviewStateInTransaction(tx, materialId)` 是内部原生事实端口，不是授权或客户端 DTO。调用方使用 Read Committed，从尚未持有 job/material 锁的事务进入，保留事务直到自己的检查/写入完成。锁序为上传集合 quota → job → input → material → 原件版本/对象 → 按 ID 排序的事项 → 操作；同集合动作必须沿用该顺序，不能先锁 job 再补 quota。返回完整历史成员、当前事项、不可变操作、精确 draft/revision 依赖、原件及实际审计。等待后重读；released/superseded/cancelled/unvalidated 都保留事实，不能当可处理。

`currentImageDecision(state)` 只认当前 image_scope 事项指针、revision、精确 command/receipt/changes 和实际 material.review 审计。旧回执、撤销后 pending、不同裁剪区域或其他材料的操作不能恢复处理。此投影本身不授予权限。

`createInitialImageDisclosureReader(db)`（usecases/media-initial-image.ts）可供905的 `loadCurrent` 消费。它只接首次图片提取、同批媒体输入、无项目的本人创建输入：原件完整 scope 必须已由可信捕获写入且有对应 material.capture 审计，账号当前绑定须匹配 job 原签名，所有原件共同主体/限制类别都重新通过既有节点写权与原文/模型策略。`members` 是完整人员集合；物理上传成员与 revision 另按873的真实集合锁核。未知范围、跨节点、非本人输入、已存在 canonical fragment、终态 job 均失败关闭，不把该窄入口扩成通用读取。调用方必须保留905裁剪前后/模型前后重读，不跨网络持事务。首次 source 仍为 null，不能伪造片段。

输入表已接严格内部媒体变体；旧文本消费者显式收窄并保持原严格文本合同。846 内部批次与 save 账本已沿用严格 StoredRecordOriginalInput 保存媒体材料 ID，不伪造原话；AI 草稿 origin 仍为 ai_suggestion，公开文本 RecordInput 与撤销的 unavailable/null 投影不放宽。此内部写入端口仍要求 producer 在同事务完成真实来源授权，结构接通本身不能处理尚无 canonical 完整来源的媒体。canonical 图片来源已在同一 person/source 快照读取全部捕获范围与经926验证的解析包，保留其他创建者和 superseded intake 限制；未知范围、缺实际捕获审计、解析篡改失败关闭，公开读取仍走现有当前权限。此片仅开放 original 类图片；其他媒体类别仍失败关闭，等待各 producer 的真实分类。捕获写端必须在原件版本锁下追加真实范围事实，不能改写已知捕获范围或绕过完整共同主体；保存图锁与来源复读保持既有边界。845 createFromSources producer、媒体确认整链和 worker 的媒体分支仍待接入。此交付不宣称图片→模型→926→845整链完成，不宣称生产路由可用。人工补采集流程尚待所有者选择，不把结构注释变成全材料强制确认。

正式迁移遵守873→269游标。所有测试默认使用正式迁移；本机媒体及文本/保存组合回归可显式传 `QTALENT_MEDIA_TEST_MIGRATIONS` 指向 Drizzle 原生生成的临时目录，SQL/meta 不进仓库。临时结构通过不等于默认正式CI通过。
