# BOW-860：说话人人工绑定组件与原生依赖

## 固定输入

前轮在原 PR #279 分支普通合入 main `27d7da28b887d3e0b8043a7ee3cdd915e67c2d56`，没有 rebase 或强推。897 的材料回执和 899 的节点授权已在 main：直接消费当前 `contracts/material-review.ts`（最近改动 `42056e02226f4c53a0b595d549dd329c158b70c4`）、`authz/evaluation-node.ts`（最近改动 `de21f0057fbea79d6e06cf30b9d55a27c2dfdd96`），以及已合 858 展示项/恢复元组，不复制契约或授权实现。

本次q852从前轮固定e5020a6沿原分支追加最后整改，不重置轮次。859尚未合入。本片仍导入其实际转写/绑定/处理上下文类型；独立验证输入固定为 #276 已提交的 `905a2ea911ccfcd5fe640a5e0b783a10c50226c0`，包含同一 attempt 的租约接管语义。生产真实组合仍待 859/846 和 X1 整合，不把验证树的输入复制进本任务分支。

本片只有领域规则、读取投影和显式事务端口用例，尚无生产数据库、HTTP/action、worker/producer 或完整原件授权适配。内存事务测试验证规则和端口协议，不能证明实际落库、排队或恢复完成。

## 人工决定与版本

- 完整 inventory 保留每个语段的稳定 fragment/reviewItem/providerSentence ID、原件与转写版本、原文和时间。空 providerSpeakerId 继续待核对；沿用 859 的 fragment ID 作展示 key，不能当员工 ID 或合并全部 null 语段。
- bind、标为无关、稍后、撤销均由人显式发起。同一转写中同一非空供应商 speaker 编号的命令覆盖该组，null 只处理当前语段。候选为当前集合成员、当前目录与实际 899 节点授权的交集，不使用旧候选提示、相似姓名或模型推断确认身份。
- 追加人工署名、墙钟时间、item revision 和 bindingRevision，不覆盖或删除已有决定。稍后不能代替已绑定/无关的显式撤销；同状态不重复署名或恢复。
- 条目/组状态改变推进 item revision；归属、无关、未解决之间变化推进 aggregate bindingRevision。事务同时 CAS 双 revision，并核集合成员版本。客户端不能注入署名、aggregate revision 或恢复任务。
- 归属变化须读取当前版本全部待确认草稿与已确认结果事实。仅失效真实待确认草稿，并核返回 ID；存在已确认结果则冲突，交 846 显式修订，不能静默改写。未知事实不能当空集合。

## 当前权限与恢复

完整原件涉及人员范围须已知，逐一核其节点和全部 requiredKinds 的 source-read 权限。片段完整不等于原件可见。写入另需 846 当前 actor/collection/membershipRevision 的处理写许可；读取许可、配额范围、worker canProcess 均不能替代。旧绑定人员已不可见时读取仍关闭；有当前处理许可的修复动作允许逐组消除已有失效绑定，但不得新增失效绑定。失效集合按(fragmentId,personId)成对核对，不按人员去重后比较数量；初次加载的集合冻结到异步后verify，期间另一原有效绑定失效会回滚。plan、verify和无恢复重放复用同一门禁。bind目标仍必须当前可见、属于材料且有节点权限；原绑定人的不可见身份不从回执或读取中泄漏。

只有完整 inventory 中全部语段 bound/irrelevant、本材料或受影响目标没有阻塞项、当前许可有效且未取消、worker 可处理，才形成恢复计划。当前真实 `materialId`、接受的 `resolution`、全部当前可披露的 `remainingReviewItemIds` 与目标范围内的 `blockingReviewItemIds` 按最终 897 回执返回，并验证整个冻结 schema 的 refine。

`SpeakerBindingSnapshot.otherReviewItemIds` 是该批次内**所有其他当前可披露的剩余项**，包括其他录音的speaker项；只排除本转写的items，不按种类裁剪。新增必填的 `otherBlockingReviewItemIds` 则只含其中会阻塞本材料/受影响目标的项。两者必须由同锁下的真实待核对范围解析产生，后者须为前者的唯一子集。`null` 或缺失代表未知，动作返回业务冲突，不能用 `?? []` 放行；不按 ID 名称、客户端提交或材料批次总数猜阻塞归属。无关剩余项保留在回执，但不扣住本材料。异步提交后会再次核对这两个集合，变化时整体回滚。860 不删除 905/906 等所有者的条目。

当前 859 只接音频 recording 时间引用，视频应用 lane 仍未接。

用例按 actor/operation 锁 → recording/collection/job 锁 → 当前事实与授权 → 幂等记录 → 双 revision CAS/追加 ledger → 草稿失效 → 可选恢复 → 审计/回执 → 再加载当前授权与版本执行。全部端口须共用同一原生事务，任一步失败整体回滚；禁止在事务回调外发队列。相同 actor/key/语义输入重放前仍核当前写权、bind命令目标及原件/转写/成员版本；无恢复的修复回执可在其他旧失效绑定尚在时重放，不新增决定/审计/排队。重放第二次加载不得新增相对第一次加载的失效对。原回执若含resume，则全材料绑定必须仍有效，不能借历史回执恢复失效材料。

恢复端口同事务存真实 resumeGrant，重开原 processing checkpoint，并按 recording/original/transcript/bindingRevision 唯一业务键 enqueue RecordingWork。回执 jobId 为原 processing job ID，不是 pg-boss message ID。恢复元组为 `(recordingId, transcriptVersionId, bindingRevision, operationId)`；859 消费时重新核 grant、job/attempt、当前许可和完整绑定。收到 resume 消息本身不授予许可。

## 最后整改与部分交付（1/2 → 2/2）

B1使用两组以上语段先由实际领域/用例绑定同一人，再分别改变当前目录候选和材料成员，覆盖逐组unbind、mark_irrelevant与改绑。修复期间剩余旧失效绑定可以保留，但任何真正resume都要求所有bound人员当前有效。旧失效绑定并未被偷偷改为pending、换人或删除人工历史；读取继续拒绝整份有不可见绑定的结果。动作回执的remaining/blocking仍按冻结的pending/deferred及服务端范围形成；即使它们为空，当前bound人员无效也不能resume。

已有「最后一个合法绑定不得恢复」回归保持no-resume断言；原实现把整次动作拒绝的断言会固化B1，现允许合法修改而继续禁止恢复。原单组修复、正常恢复、越权和已确认结果保护保留，新增提交/重放异步后目录变化与写权撤销负例。首次pending、原生ledger及完整恢复没有在本轮伪造。

### Q1：通用undo与已解决投影属于860

按897的`MATERIAL_REVIEW_POLICIES.speaker.owner`和`materials.md`，这是本卡合入前置。`resolution.action: unbind`只是既有解决命令中的人工归属变更，**不是**`materialReviewUndoCommandSchema`，不产生通用undo回执或可核验auditId。当前`read`仍是旧speaker/items组件读取，不能当作完整批次`resolvedItems`入口。

最小领域入口应消费现有897类型；以下是给原生窗口的接口方案，尚未实现/导出，不是空成功端口：

```ts
// 使用现有MaterialReview*类型，不修改公共DTO；此接口尚未实现/导出。
type SpeakerResolvedItem = Extract<
  MaterialReviewResolvedItem,
  { kind: 'speaker' }
>;
type SpeakerUndoCommand = Omit<MaterialReviewUndoCommand, 'kind'> & {
  kind: 'speaker';
};
interface NativeSpeakerReview<C> {
  readResolvedSpeakerItems(
    tx: C,
    accountId: string,
    batchId: string,
  ): Promise<SpeakerResolvedItem[]>;
  undoSpeakerReview(
    tx: C,
    accountId: string,
    command: SpeakerUndoCommand,
  ): Promise<MaterialReviewUndoResult>;
}
```

`SpeakerResolvedItem`为`Extract<MaterialReviewResolvedItem,{kind:'speaker'}>`；`SpeakerUndoCommand`为现有通用undo命令中kind限制为speaker。前者必须按当前权限过滤问题和结果，真实source/quote（可空）、revision、typed resolution、resolvedAt和auditId来自同一人工决定，未决/稍后/解绑项不能冒充已解决。当前绑定涉及人员已不在可见范围时保守拒绝，不返回旧personId；没有当前结果的真实ledger不能用`[]`伪装已完整读取。

现有数据缺口与X1最小共享请求：

| 所需事实/能力                                                                                                        | 当前真实边界                                                                 | 原生窗口责任                                                                                   |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 当前item/组人工决定的源operation、覆盖fragment/item及各revision、resolution、resolvedAt、auditId和材料/原件/转写身份 | `decisions`只有署名/时间/状态；`appendAudit`返回void，snapshot无逐项审计引用 | 859/860原生人工ledger同事务读取真实当前决定；审计必须返回实际ID，不用operationId或随机UUID冒充 |
| 此决定依赖的全部待确认草稿和已确认结果                                                                               | 当前derived只是bindingRevision聚合端口，没有逐决定的真实反向依赖查询         | 846提供同锁完整依赖、当前确认/撤回事实与当前写许可；未知即冲突，不默认无依赖                   |
| undo与resolve隔离幂等、双revision CAS、pending投影、追加审计与真实失效ID原子提交                                     | `SpeakerBindingOperation`现只存解决回执，无undo变体或原生存储                | X1串行确认原生ledger/审计/幂等归属及必要schema/迁移，再由860补实际消费；公共出口由X1接         |

原生ledger还须给出源决定实际覆盖的条目组；不能按同一个personId猜组，也不能只撤一个投影而让同一次人工组决定继续处理。无法核对源组/当前修订就冲突，组内各条目以各自revision做CAS，回执指向所请求的同一item，其他材料不撤销。

原生事务顺序：actor/operation（含resolve或undo动作区分）锁 → recording/collection/job及依赖草稿锁 → 同事务重查当前处理权限、真实事项/决定/成员/来源/原件/转写及expectedRevision → 读取真实确认依赖 → 追加撤销审计、双CAS转pending、失效全部受影响未确认草稿、幂等回执 → 异步后再次核事实/权限 → 原子提交。回执必须通过897 undo schema：previousRevision、同一item pending且revision恰加一、实际invalidatedDraftIds、同事务auditId和resume:null；不调模型、不自动排队。再次明确解决才走当前权限与完整来源范围。

同键同语义重放原回执，仍重查当前权限、事项/版本及截止边界，不增加审计/修订/任务；同键跨动作、异内容或新键旧修订冲突。任一依赖草稿已确认就冲突，不删除或重写人工确认。只有先由846原有服务器墙钟5秒窗口（elapsed恰5秒关闭）完成确认撤销，才能重新核对；860不改窗口、用业务演示时间延长或给历史长期改回待确认。说话人没有面评行导入分支，不借此扩大其他类型权限。

本阶段只交B1/S1组件整改和该精确依赖方案；没有新schema、PG ledger、undo成功handler或假resolvedItems。共享请求见#248本轮窗口登记，最终原生实现与集成验收仍待X1/846/859，不关闭整卡或声称Q1功能完成。

## 待整合

- 846：当前集合/成员、处理写权与成员版本；同锁下读/失效待确认草稿；已确认结果显式修订。
- 859：可信完整 inventory、当前 job/attempt/checkpoint、实际绑定 ledger 与 resumeGrant。首次转写须由真实适配器把所有未知片段（包括 null）保留为 pending；供应商编号或候选不构成人工绑定凭证。当前纯组件无法证明适配器没有伪造 bound，须在原生 ledger 接入时验收。replacePendingReview 只更新待核对投影，不删除人工决定。
- 待核对范围适配：同锁下填充 `otherReviewItemIds` 与 `otherBlockingReviewItemIds`，并重核材料/受影响目标及当前披露范围；无生产默认空数组。
- 837/873/908：完整原件当前范围与访问授权，不能从片段反推。
- X1/852：存储/原生事务适配、公共出口、唯一 producer/worker 和最终迁移。未接之前无 fake 默认成功。

## 验证

独立 detached 验证树以本任务普通合入 main 的提交为底，仅加入 859 固定 SHA 的六份原始文件：`recordings/{types,policy}.ts`、`uploads/{handoff,types,service,content}.ts`。后四份是前者类型的传递依赖，不是新产品改动；这些文件均按原 blob 核对。然后逐字同步本片五文件，897/899 与其余 main 文件保持不变。

- Red：未改产品代码时，当前 main 契约 + 固定 859 输入的原 48 项实际 25 失败，三字段缺失与审查 6553599510 一致。新增回归先跑 Red 后修复。
- 前轮覆盖回执材料/动作、目标阻塞子集、无关项不阻塞、未知/缺失事实冲突、恢复后的范围变化回滚，以及requiredKinds无权、错误jobId、草稿已清空但失效ID错误；本轮在相同固定输入上先得到多组失效Red4失败/62通过，再完成统一修复及异步反例。
- 实际运行已安装的锁定 Vitest：`node node_modules/vitest/vitest.mjs run src/server/modules/records/speaker-binding.test.ts src/server/usecases/speaker-binding.test.ts --maxWorkers=2`；覆盖率再加 `--coverage --coverage.include=src/server/modules/records/speaker-binding.ts --coverage.include=src/server/usecases/speaker-binding.ts`，沿仓库行/分支 85% 门槛。
- 依赖安装先因未批准的构建脚本返回失败，未运行 approve-builds 或改配置；验证树用 `pnpm install --frozen-lockfile --ignore-scripts` 安装锁定依赖。测试没有批准或运行这些构建脚本。
- 本次固定组合74/74通过，两生产文件合计行96.82%（244/252）、分支93.77%（256/273）；新的候选失效集合与实际resume/读保护分开验证。
- 原任务分支仍缺未合入 859 的 `recordings/types`、`recordings/policy`，类型/单测无法完整运行；组合验证不等于默认 CI。PR 保持 Draft + blocked，等待实际依赖与跨工具新 head 复核。
- 本轮不连接 PG、不加载凭证、不启动服务、不调用供应商，不验证原生事务、真实持久化、唯一 producer 或完整恢复。具体受检提交、实测数量和检查结果写在 PR 对应 head 的证据中。
