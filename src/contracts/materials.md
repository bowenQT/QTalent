# 材料批次契约（BOW-897）

本页与 `materials.ts`、`material-review.ts`、`record.ts` 同步维护。11/1 依据：[所有者裁决第 1 条](https://github.com/bowenQT/QTalent/issues/248#issuecomment-6551983878)。旧指针 `0b20a913` 的 rvw1 审查与产品分歧历史保留。本次新口径续作的第 1 轮已由 rvw2 审过 `ac043b5`；依据[补充裁决](https://github.com/bowenQT/QTalent/issues/248#issuecomment-6552570221)补撤销和已解决投影，仍计第 1 轮修改，另按[提示裁决](https://github.com/bowenQT/QTalent/issues/248#issuecomment-6552620048)增加仅布尔的权限隐藏提示。之后依据[问题展示与五秒窗口裁决](https://github.com/bowenQT/QTalent/issues/248#issuecomment-6552938557)补已解决项的问题字段，并明确确认撤销的五秒边界；既有 R1 修改 1/2 和 rvw2 对 `9e94932` 的通过保留，本次补充范围单列，不全面重置。

## 回执是一份逐项快照

`materialBatchReceiptSchema` 同时返回 `files`、`items`、`resolvedItems`、`draftSet`、`confirmedDrafts`，没有互斥的整批确认门禁：一个文件处理中、另一处待核对、一个事件待确认和另一个已确认可以同时出现。

| 字段                                               | 口径                                                                                                      |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `files` / `counts.files`                           | 上传文件数及每种文件状态的数量。`parsed` 只表示文件解析结束，不表示人工确认                               |
| `personIds`                                        | 服务端已确定、当前可见的主体；未分配输入核对绑定后会变化，不是原始输入的永久副本                          |
| `hasHiddenContent`                                 | 服务端构造当前授权快照时给出的单个布尔值；true 只提示「部分内容已按权限隐藏」，不返回隐藏数量、类别或身份 |
| `resolvedItems`                                    | 当前已解决核对项的只读投影与处理结果，包括名单外仅保留原件；不计入未解决核对数或事件数                    |
| `textMaterial`                                     | 文本输入保存的材料与原件版本；不算上传文件                                                                |
| `items` / `counts.reviewItems`                     | 尚未解决的核对项，包括 deferred；单位是处，不是文件或事件                                                 |
| `draftSet` / `counts.events.awaiting_confirmation` | 已确定主体/可信范围的 AI 事件草稿；无此类草稿为 null。仍保留重复候选的逐草稿确认阻断                      |
| `confirmedDrafts` / `counts.events.confirmed`      | 每个稳定草稿的原生人工保存映射（人员、事件 ID、草稿修订）；不含伪造的 AI 已确认分                         |
| `counts.events.total`                              | 当前可见待确认草稿数与已确认草稿数之和；按事件草稿计，不按人员计                                          |
| `jobId`                                            | 仍在运行的文本/整理工作；与文件自己的 jobId 区分                                                          |
| `error`                                            | 真实整批执行失败的原因、可重试性。文件失败/不支持另保留自己的原因                                         |

`counts` 必须与上述数组来自同一份已授权快照；Zod 拒绝不一致的计数、重复材料/草稿/事件映射、跨批次/节点/版本关联、同一草稿既待确认又已确认。存储不另建一份可变的计数或批次状态真相。权限先在服务端过滤，不能只过滤列表却返回隐藏对象的总数；不可信/读失败不得冒充 0。

摘要标签按原型 `311c8da:prototype/y/app/js/intake.js` 的顺序：仍在处理 → 待核对 → 待确认 → 已完成；明确的整批执行错误为 failed。**标签只用于展示**。确认入口按具体草稿当前权限、修订和本草稿的阻断判断，不以 `receipt.status === 'awaiting_confirmation'` 为条件。待核对或处理中的批次同样可以确认已满足条件的草稿。

所有文件/文本工作、核对项、待确认事件都结束才为 completed。completed 表示处理结束，不代表所有文件成功，也不代表产生了人才结论：失败/不支持逐文件可见，原件保留但没有事件也可以完成。不得由已完成状态推导已导入、已评分或已执行人事动作。

## 课题与模型边界

批次输入的 `projectId` 是所选课题上下文，null 表示入口尚未选择；每个 `recordBatchDraft.projectId` 保存该事件已解决的课题归属，null 为明确无课题。课题待核对使用 `unknown_project`，可关联当前可见的已有课题、明确无课题或延期；不存在自动建课题动作。不同事件保留自己的明确归属，不因批次默认课题静默改写事件。

节点、课题、人员 ID、候选列表都是查找身份，不能证明授权。主体与可信范围未确定时，待核对项只有定位和选择，没有 SBI 或建议分。服务端须在模型前按真实身份、当前评价关系和完整来源范围过滤；单纯选择节点、空人员列表或选择课题不能放行。每个待确认草稿必须已通过这个边界，不能借部分确认把未确定的片段交给模型。

## 六类待核对

| kind                          | 当前处理者（服务端解析）           | 处理与恢复                                                                                                                             |
| ----------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `speaker`                     | 当前节点评价人 / 范围内管理者或 HR | bind、mark_irrelevant 后回整理；defer/unbind 不排队                                                                                    |
| `unknown_person`              | 同上                               | bind_people 后回整理；keep_original_only 表示「名单外的人 · 只保留在原件里」，受影响内容不建人、不出分、不交模型                       |
| `image_scope`                 | 同上                               | confirm_scope 回图片范围检查，真实裁剪且复查后才能外发；keep_attachment_only 表示「整张只作附件 · 只给对整张图有权限的人看」，不交模型 |
| `unknown_project`             | 同上                               | link_existing_project / mark_no_project 后回整理；选择不是项目或人员授权                                                               |
| `unknown_interviewer`         | 范围内 HR                          | 关联目录已有面试官，回同一 PDF 导入行                                                                                                  |
| `unknown_interview_candidate` | 范围内 HR                          | 关联目录已有候选人，回同一 PDF 导入行；名单外 keep_original_only 保留原件并跳过此行，不产生人员关联                                    |

`original_only` 与 `attachment_only` 文件终态表示整份文件只保留原件/附件的情况，不要求一个名单外姓名就丢掉同文件内其他可授权片段。保留原件不扩大受众。整图附件的每次读取仍须按全图全部主体与内容性质授权；主体/范围未明或越权就拒绝读取，不能把此动作当全图授权标志。

面评候选人与面试官核对均有 PDF 位置、原件版本和 `importRowId`，不绕回普通 organizing。导入之后，**人员关联与面试官关联均只读，更正须先撤销导入**。导入/核对/重放事务检查原生行状态；已导入行的旧核对命令返回 conflict 并保留输入，不能直接 relink 或撤销旧核对来改关联。撤销导入须记审计；随后以新修订重新核对和导入。正式的历史迁移更正流程属于赛后。本契约不声称实现了原生事务或持久化保护；由 BOW-906 接线验证。

## 恢复与幂等

恢复回执增加 `materialId`、接受的 `resolution`、`blockingReviewItemIds`。`remainingReviewItemIds` 是整个当前可见批次剩余项；`blockingReviewItemIds` 是本材料/目标仍未解决的阻断，必须是前者的子集。只有本目标无阻断才可以恢复，其他文件的核对不阻塞此目标。恢复仍绑定本次核对项所指的材料/导入行，不能指定任意任务。

defer、unbind、keep_original_only、keep_attachment_only 均要求 `resume:null`；保留类动作不排模型工作。新回执回显 resolution，不能用不带动作的回执伪装已获模型权限。响应中的范围和阻断也不是后续请求的授权证明。

相同当前操作者、operationId、语义 payload 重放原回执/任务；改变 payload 或旧修订 conflict。当前授权、原生导入状态、材料与来源绑定在重放前重查。解决、旧草稿失效与精确恢复排队需同事务提交，不重复写、重复入队；并发/数据库/重启等证明由各实现卡完成。

## 撤销核对与已解决投影

六类解决结果均可使用 `materialReviewUndoCommandSchema`：`action: undo`、kind、batchId、itemId、expectedRevision、operationId。修订指向当前已解决项，不是批次修订；调用者不能附带处理者、权限、已确认/已导入标志或替换结果。服务端解析当前处理权限与真实事项、材料/原件、节点和面评行绑定。处理者与原解决动作相同，过期关系按 899 交 HR 分派；知道旧操作者或 itemId 不授予撤销权限。

`materialReviewResolvedItemSchema` 返回当前解决结果的 kind、稳定 itemId、revision、材料/原件和来源定位、typed resolution、resolvedAt 与 auditId；两类面评核对保留同一个 importRowId。其中 unknown_person、unknown_project、unknown_interviewer、unknown_interview_candidate 必填可空的 observedName，说话人必填可空的 quote；其他类型不接收这些不适用的字段。非空时须有实际文字，null 表示没有可展示的问题文字（包括当前权限要求隐藏的情况），不能借 null 推导隐藏数量。读取时先按当前权限过滤问题与结果，再展示「问题 → 结果」；图片继续用来源与范围定位。问题文字与引文只用于只读展示，不因已经解决而自动成为模型输入，模型调用仍须重新检查完整主体与来源范围。它不是可写历史表，不带候选列表、AI 草稿或建议分；defer/unbind 仍是未解决状态，不能冒充已解决项。当前快照的同一个 itemId 只能在 items 或 resolvedItems 中出现一次。名单外的结果保留 `keep_original_only`，没有人或事件也能显示「已标为名单外的人」。

`undo` 只读元数据为 available，或 blocked 加原因 `dependent_draft_confirmed / interview_row_imported`；后一原因只用于两类面评核对。页面只在相应源动作仍可撤销时引导，不由页面标志放行写入。撤销截止条件由服务端在源用例的事务/锁后查真实依赖：任一依赖此核对的草稿已确认，或所关联的面评行已导入，就返回保留原输入的 conflict。不同人员另一次确认同样阻断；不能只看原处理人、页面状态或批次是否完成。确认撤销只沿用 BOW-846 现有的 5 秒服务器墙钟窗口：从保存回执 savedAt 起算，0 <= elapsed < RECORD_UNDO_WINDOW_MS（5_000ms），恰好 5 秒即关闭；不能用演示业务日期或客户端时钟延长。窗口内仍须按 846 的当前权限、版本与后续确认/复核保护检查，通过原撤销确认后才能重新核对；窗口外已确认内容只读，保留原版本并记录更正的流程放到赛后，不提供长期「改回待确认」。关联面评行仍须走原有的审计撤销导入流程，不扩大它的权限。本卡不改 846 或 P0 撤销协议，不改写人工确认历史。

成功的 `materialReviewUndoReceiptSchema` 必须有同事务的 auditId、previousRevision、同一核对项回到 pending 且 revision 恰加一、受影响的未确认草稿 invalidatedDraftIds，以及 `resume: null`。项从 resolvedItems 移回 items，材料、来源、事项 ID 保持稳定；相关主体/范围需重新核对。撤销不自动调用模型、不自动排队，不返回可沿用的 SBI 或建议分，也不撤销其他材料的核对。后续显式解决仍走模型前当前身份与范围过滤。

撤销、审计、未确认草稿失效和新修订需原子提交，失败整体回滚；并发与确认/导入互斥。幂等键包含动作和语义 payload，不能让同一个键在解决与撤销之间串用。重放仍先检查当前权限、事项和截止边界；同键同内容重放原撤销回执，不加修订、审计或任务；同键异内容和新请求使用旧修订 conflict。具体事务、幂等账本和并发验证属于源实现卡；本卡只有契约校验，没有模拟成功的运行时端口。

## 下游切换

这是新冻结输入，不能与旧 `0b20a913` DTO 混用：批次输入/草稿须提供 projectId；回执改为并行快照与校验计数，并必填 resolvedItems 与 hasHiddenContent（无已解决项为 []，未隐藏为 false）；已解决的四类名字问题须带 observedName，说话人须带 quote，无当前可展示文字时显式 null，不能省略字段；恢复回执须带材料、动作、目标阻断；待核对增为六类。899 的待办类型/具体事项引用、845/846/873/906 的实际读写与页面均须明确同步新 SHA 后复验。X1 重新冻结指针后再排最终迁移。

P0 `source*`、七格式上传与单草稿协议不变。新增的是待核对 kind，不是评价节点 kind；919/923 的节点类型裁决不在本次范围。本次不写业务实现、共享出口、迁移、包或原型，不以 schema 通过冒充授权、持久化或真实供应商验证。
