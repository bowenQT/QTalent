# BOW-846 → BOW-845 原生来源确认续作

本窗口从 main `71f8d9d` 普通组合已完成的 #289 `1a431c3` 与 #185 `271f268`，组合点 `6e4b49e`。不修改 #289 的最终 R2；其原始输入恢复仍明确 unavailable。本窗口承接先前登记的生产接线缺口，不增加重新生成用户动作。

## 来源与当前权限

新文本在人工确认前只有原件、版本、片段和真实 intake；不能为了读取来源先插一条 event。确认读取把所有匹配 intake 的 sourceContexts 与完整正式 event/history 关系合并，保留其他主体、节点和 requiredKinds，包括旧 intake 的限制。创建账号、选择人员、AI 的 personIds 或 attributedPersonIds 都不是完整来源主体证明。

只接已存在的原生文本生产事实：batch/node/boundAt/occurredOn、唯一 inputSource、原件类型、准确片段定位、原始字节摘要及 canonical RecordInput 文本须一致。RecordInput 按合同去掉外围空白，原件片段和摘要仍保留原始字节。没有实际接入的附件/录音不能默认成文本或空来源。既有正式图若包含不能解释的关联，intake 不能把它补成“完整”。

合并后的事实继续交既有 resolveRecordSourceFacts 和确认领域规则校验。每次首次保存、重放、撤销都重新加载当前服务端身份/节点权限，逐主体检查主 kind 与每个 requiredKind；不把整理时的创建者权限缓存成当前确认权限。

## 唯一入口

所有来源读取只经过 `talent-source-projection.ts` 的两个函数：`readIntakeTable(tx, mode)` 读完整的 arrange_inputs（不按创建人、人员、批次或 superseded 过滤），`completeTalentSources(data)` 把正式来源图与所有匹配 intake 合并。`IntakeTable` 只能由 `readIntakeTable` 产生：它是模块私有类的实例，登记在模块私有的 WeakSet 里，行数据是深度冻结的私有副本；`intakeRows` 和合并步骤只接受登记过的表，展开复制（`{ ...table, rows }`）或手工构造的对象都会被拒绝，所以调用方无法传入过滤过的子集。生产代码没有测试用的构造函数；单测经 `talent-source-projection.test-support.ts` 用真实 `readIntakeTable` 入口从内存行构造。原始来源图和本文件的合并步骤都不对外使用，`talent-source-projection.guard.test.ts` 用 TypeScript AST 解析全部导入写法（含命名空间、再导出、动态 import、require），列出全部调用方。

锁顺序：所有原生批次任务事务（runner、取消、重试）在锁任务行之前先取 intake SHARE；提交请求先取 intake 写锁再锁任务行。整理时，同一片段其他 intake（含已作废）并入的主体，与当前 intake 的主体一起锁定人员、节点、关系等权限行，等待后重读权限。

| 调用方                                                     | 读法                                                                                                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 档案、原文、速览、模型输入、导出、批次回执与任务控制的授权 | `'snapshot'`：在调用方自己的快照里读，不加锁。intake 只会给片段增加主体和 requiredKinds，所以即使在 READ COMMITTED 下，并发新增的 intake 也只会收紧读取 |
| 确认、整理把来源交给模型前                                 | `'locked'`：先拿 SHARE，再锁 batch / draft                                                                                                              |
| 提交新批次（本事务插入 intake）                            | `'locked-for-write'`：事务第一个锁是 SHARE ROW EXCLUSIVE，避免两个写者都先持 SHARE 再升级时死锁；插入后在锁内重读一次，结果包含本行                     |

没有正式关联的新文本（首次保存前）主体只来自匹配 intake 的并集；任一匹配 intake 未通过完整性校验，或片段有正式关联却没有正式主体时，主体为空，所有读取一律拒绝。

## 事务边界

intake 的 JSON 来源没有片段外键，锁已有行不能排除并发插入的另一份共享 intake。确认事务先取 arrangeInputs 的 SHARE 表锁，再锁 batch/draft、正式来源图和当前权限；不在 batch 锁后取得 input 行锁。表锁只在当前事务持有，允许并行确认读取，阻止 intake DML；代价是短暂串行化 intake 写入。所有来源读取在锁定后发生，等待另一个 intake 提交后必须重新读取。

正式 source graph 仍用原有外键父行锁，不改变其授权算法。真实 PG 测试验证等待中的 SHARE 锁以及对刚提交扩大主体的拒绝，不用时间等待代替锁证据。

## 确认后的回执

846 人工保存会推进 draft revision；历史 AI 快照不会改写。845 回执须验证 save receipt 的 revision = 历史快照 revision + 1 且不大于当前 draft revision，并核对除 revision 外的 AI 内容完全相同。不能要求旧快照版本等于当前版本，也不能删除历史来消除差异。

## 内部修订与持久任务栅栏

本适配消费 X1 唯一 `reviseTrustedRecordDraftBatch`，传真实 batch revision 与完整 draftId/revision 集合；稳定事件键从持久 manifest 找回原 draftId，不重新分配。模型前后读取实际人工保存与事件映射，任何保存（含撤回历史）都禁止生成覆盖；CAS 再检查一遍并随同任务更新原子提交。模型等待期间若另一个修订先提交，旧返回不得覆盖它。

operation 携带唯一 job 行的真实 revision。claim 写入按当前 revision 校验，返回实际提交后的 revision；协调器保存该值并在模型返回时对比当前行，再把 expectedJobRevision 交给原生持久层复核。attempt、输入版本、完整 trace、取消状态仍各自检查。取消请求推进版本时按当前取消分支终止，不把它当成功生成。没有内存计数、第二份任务表或新的用户状态。

内部修订 PG 测试显式准备已排队的服务端状态来验证既有能力；这不是新增“重新生成”页面动作或已存在生产触发的证明。当前真实用户链路仍是首次整理、已有回执读取及人工确认。

## 仍需完整交付的依赖

- X1 CAS与公共出口已按固定交接消费；本用例不生成 SQL。
- 已普通组合845正式0009与唯一worker注册；后续验证使用仓库默认正式迁移，退役临时目录覆盖。845 PR须实际合入，不能把组合代码当作main前置已满足。
- 内部修订只消费已存在 generation=revise 合同，不新增用户入口。
- 完整当前 head 回归、正式 CI、跨工具审查与 X1 门禁全部完成后才能称此后继 PR Ready。
