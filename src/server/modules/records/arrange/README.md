# BOW-845 决赛批次整理：本轮独立逻辑

本轮沿原PR185/head110970d追加，显式普通merge main91b297a、843/d688c92、897/0b20a913与899/d5cf82fa，组合基线765af8cd3f339dc6d33e1cae36c32d05ef2fd023。只新增batch、batch-prompt、batch-validate及测试和usecases/record-batch-arrange及测试；下面的10/25单草稿存储/应用说明保留作历史，不能当作当前多事件已接线证据。922分类读取语义固定806c1af；本片用官方类别合同和必需的同事务readRules适配口，不复制SQL或声称已调用真实922读取。

## 当前实际行为

- `prepareBatch`消费当前服务器账号/节点/完整来源事实，调用固定899的canReadNodeTalent/canReadTalent。隐私完整共有人与requiredKinds全体通过，另用独立已核实attributedPersonIds约束行为归属；选中人员不改变来源归属。只投影明确请求的片段，不发送整个档案或额外可见资料。身份/范围/说话人绑定未定时零模型调用，不从节点选择推断外发许可。
- 接受可信文本、已绑定且含真实版本的解析片段、完整离线稿片段。859的引用ID必须经真实loader解析为正文、原件/转写版本、当前绑定修订及当前权限；901的ParsedOffice必须完成原件/fragment/parse版本绑定和归属后才能成为BatchSource。900面评属于906历史评价链，原量表不能借本用例转成维度建议。图片/video/code材料不在本片已接范围，不输出产品级的“不支持格式”回执来冒充全链结论。
- 版本读取参数固定category=dimension_anchors、at=服务器保存输入的boundAt。分类read的有效版本与其权威内容映射一致，再分别冻结dimensionVersionId/anchorVersionId；不从版本名推导、不要求全表唯一published、不回退其他类别/演示版本。后续发布仅改变历史有效区间时，旧输入不会重算或换版。
- 复用843真正的Modelink类型、MODELINK_MODEL和generateStructured协议。版本化prompt/具体ZodObject输出多个AI事件建议，模型临时eventKey不是持久ID。逐字校验引用的版本/位置/原文、个人归属和冻结锚点；不合格评分降unknown且清除value/anchor/citations，不伪造引用。评分引用只能来自该事件自己的证据语句，不把同一段内另一事件的行为拿来打分。
- 一个人两件事保留两份建议；同一事件的多份证据在该事件中取来源并集。模型相似提示及同人员/同事件依据的重复建议组成待人工选择的候选，重叠提示合成一组，保留全部事件，不自动作语义合并或全库去重；改写标题/评分或调整引用顺序不能绕过候选。人工合并/分开及正式确认仍需后续版本化事务。
- 唯一模型调用在事务外，前后都读当前权限/输入/源版本/归属/规则事实，并比对输入指纹与批次revision。操作ledger绑定account/batch/operation/attempt；并发重投只有一方占running，同键重放先重新授权。已完成结果仅在仍为当前修订时回放；未知发送结果不盲目重发。只有明确network+retryable允许显式第二次尝试，不自动重试；本地取消不保存迟到结果。

## 服务器身份与事件修订

同事务 `reserveIdentities` 必须从真实服务器账本给出本批次的draftId、previous草稿及去重candidateId；本片没有随机ID生成器或“按人员生成ID”。同操作/输入重放复用reservation；正文变化保留draftId、递增草稿revision。提交metadata显式携带eventKey→draftId→原文witnesses映射，要求与草稿及操作在同一事务持久保存；下一次revise从这份已存映射读取，不从新模型输出或预期JSON反推旧事件身份。映射表达待确认AI草稿的身份依据，不是人工正式结论。

revise输入还必须由服务器账本给出完整 `generation.events[{eventKey,draftId,witnesses}]`。每个事件的引用/原文依据须当前可读、可区分；模型只见key及已授权witness，不见持久ID。输出必须保留本事件依据，不得挪用另一个事件的独占依据，reservation的ID也须与manifest绑定一致，防止两件事保持key却交换ID含义。新增/消失事件、来源版本替换或无法对应的重切分，需要显式人工/服务器重新对齐，当前拒绝自动猜配；这不是已完成任意再生成接线的声明。

正文/引用保留原始字节。最终DTO只做schema验形，不采用会trim quote的解析结果。897新batch quote仍沿text.trim合同；跨入口消费者若重新解析会改变两端空白，需X1/合同writer统一处理，本片不改冻结合同或用裁剪后的quote冒充原文。

## 后续接线门禁

`BatchArrangePorts.locked` 必须是真实同原生事务的batch/operation/job锁，Read Committed/CAS、当前writeAllowed/身份/成员/节点图/来源完整分类、922分类读取和内容绑定、原始输入与media解析版本及860绑定ledger都需生产loader提供；没有allow-all或默认绑定。reserveIdentities/persistDraftSet/元数据/操作完成必须原子提交，返回receipt需精确一致。这里的内存回滚测试不证明PG隔离、FK或跨进程幂等。

846真实多草稿writer、852唯一producer/842 policy和worker注册、input-state升级、source reader/完整来源授权与最终迁移均未进入本片。旧185仍引用尚未合入的records/write、talent/write-policy、talent-source-projection、save-state/schema与app-runtime；不叠旧846/852候选schema补类型，不把新端口当生产验收。迁移仍899→922→852→846→873→845，由X1生成。897混合回执/完成态、项目归属、名单外/附件动作、主体未明前草拟等分歧继续待裁决，不借测试定口径。

本轮只用化名fake Modelink与内存端口；未读取凭证、调用付费服务、连接PG或启动worker。整卡完成还需原生writer/job链、真实模型证据及所有blocked-by实际合main，继续Refs #37 / Part of BOW-845。

---

# BOW-845：来源片段整理

依据：[SDD/TDD](https://linear.app/bowenzhong/document/bow-845-共用来源片段整理-sddtdd-v02-8eed25ecd0e9)、[BOW-845](https://linear.app/bowenzhong/issue/BOW-845)、[PR185](https://github.com/bowenQT/QTalent/pull/185)。初版和选人持久化增补均经独立 spec 评审。固定化名样例见 `examples.ts`；不作为生产 fallback。

## 输入、授权与模型

`arrangeRecord(load, client)` 每次读取可信服务器快照，使用835的 `buildAuthorizedModelInput`，只发送本次授权的 `sources.excerpt`、选择和必要规则元数据。客户端不能提交角色、授权快照或自报来源主体。不发送 generic fields、整个档案或其余事件。

`sources.subjects` 是完整隐私主体，`attributedPersonIds` 是独立已核实行为归属。共享可见不意味着给每个人复制建议分。录音/附件选人仅确定记录目标，不把选中人员批量绑定到片段或说话人。

未选人时返回 `selection_required`，不调用模型、不编 SBI。录音/附件及已分类原话在此阶段也必须通过835；只有本人新输入、尚无主体的精确原话可暂留在选人步骤，仍不得进入模型。候选标签与理由每次读取按当前权限重建，原片段版本和输入版本变化后不回放旧候选。

模型只产生 SBI 和逐人逐维建议。情境/影响可空，行为必需；引用必须匹配片段、版本、完整位置及精确原文子串。input 引用只允许授权原话的精确 UTF-16 偏移。锚点匹配当前规则版本、维度、ID、分值与文本。异常结构/身份/维度/重复评分失败；无效引用或锚点降 unknown，保留原因，不补数值或伪造来源。unknown 合同不含 citations，因此省略对应846 evidence行；缺失 rationale 保留真实空。

## 实际请求与持久化

`usecases/record-arrange-requests.ts` 实现首次输入、幂等创建/入队、查询和选择后新整理。`record-arrange-context.ts` 在传入事务内读取当前账户、目录、来源和规则，复用846的 `canConfirmOwnScore` 与837/846的 `sourcesForDraft`，不另写角色特判。用户最新以202/203为准，manager可记录/确认本人评分；当前固定846候选仍仅允许HR/导师，须等该owner统一适配SHA后复验，不能把旧组合当作新权限验收。规则只接受唯一 published 且有锚点的版本；非 production 可接受唯一 demo_import_snapshot。多候选不猜“最新”，直接拒绝不明确配置。

`records/arrange/input-state/schema.ts` 只增加两表：

- `records_arrange_inputs`：独立 planned draft ID、job ID、输入版本、原始输入/附件、可信来源主体与分类、独立归属、人员/项目选择及 supersededByInputId。选择前不写846草稿，不造 SBI 或 draft revision。
- `records_arrange_operations`：账户＋create/select＋operation_id 的幂等账本及语义指纹。当前权限先于回放检查；同键不同语义冲突。

首次原话同时生成原件版本/片段、job、input、operation及审计，pg-boss enqueue 使用 `fromDrizzle(tx, sql)` 在同一事务。入队失败整体回滚。相同操作键并发只创建一次。

选择使用已合129的 `RecordSelectionInput`：`operation_id`、`draftId`、`expected_input_version`、非空唯一 `personIds`、可空 `projectId`。行锁保护旧输入版本；只消费真实 selection_required job。重授权后新建 inputVersion/job/draft ID，原子取消旧任务并标 superseded，再入队；不同操作键并发只有一方成功。旧操作同键回放返回旧取消回执且隐藏原结果；不触发模型。通用 jobs resume 一直为 false。项目候选可随选人确认；已选人而项目仍未确定时沿原合同保留 draft.project.needs_selection，保存时人工确认。

Web 入口为 `actions/record-arrange.ts` 的 `startRecordArrangeAction` / `selectRecordArrangePeopleAction`，只取服务器 session；查询为 `readRecordArrangeJobForCurrentUser`。请求工厂复用852唯一的 lazy producer，不新建 singleton。

G2 初始上下文由 `queries/record-arrange.ts:getRecordPage({personId?,projectId?})` 返回：`{status:'success',context:{accountId,people:[{id,label}],projects:[{id,label}],selectedPersonId,selectedProjectId}}`。只接受这两个可空ID；无权/不存在的预选统一 not_found，不清空后继续，整页无可写人员时 forbidden。没有原话、授权信息、档案或评分，URL q/text/未知字段一律拒绝；accountId仅供工作台暂存隔离，写入仍重读session与当前权限。G2不依赖规则加载，G6由846提供规则入口。

866/873 可调用可信服务端入口，不能将下列 provenance 暴露为客户端写参：

```ts
await requests.createFromSources(accountId, {
  origin: 'recording', // or attachment
  originalInput, // RecordInput；保留真实原话、附件和 operation_id
  sources: [
    {
      fragmentId,
      originalVersionId,
      subjects: [{ personId, cohortId }], // 完整隐私主体
      attributedPersonIds: [], // 仅已核实行为归属；未知保持空
      kind: 'evaluation',
      requiredKinds: [],
    },
  ],
});
```

首次纯文本入口拒绝未解析的 attachmentIds。已解析附件走上面的可信来源入口，原 attachmentIds 保留。当前公共 RecordInput 仍要求非空 text；无原话的 source-only 输入不能填占位句绕过，需按可信来源上下文另定。父已授本卡唯一窄修改权：recordInput.text与recordCitation两种quote使用非空白refine、不做transform，保留前后空格/换行与UTF-16引用偏移；ID、标题、普通标签仍原schema。writer回执发生改写仍拒绝提交，不静默改偏移。

## Worker、846及共享接线

```ts
const app = createRecordArrangeApplication({
  db,
  boss,
  client: maasWithMaxAttemptsOne,
  environment,
  businessDate: () => clock.today(),
  now: () => new Date(),
});
await app.register(); // 交共享 worker 串行注册
// app.policy 交842 registry；app.requests 已是实际数据库服务
// APP_ENV=test 时显式注入 createRecordArrangeTestClient(environment)
```

`createRecordArrangeTestClient('test')` 提供固定离线整理：行为仅拼接已授权输入片段，分数全部 unknown，不猜锚点或来源；非 test 环境拒绝创建。测试无需真实 MaaS。

runner 在842行锁下 queued→running，模型在事务外；最终同事务重查写权限、来源、输入/规则/归属指纹、attempt/revision及取消栅栏，再调用846实际 `persistRecordDraft(tx,row)` 并写 awaiting_manual。846只接 id/creatorAccountId/ruleVersionId/draft/sources/evidence，返回 revision=1；不在这里产生正式 event 或人工确认。prompt/model/input/rule元数据由同 draftId 的 job result持久保存，沿846的event→draft映射回溯；不改846 schema或拼接modelVersion。

公共 policy 按已合129的 `recordArrangeResultSchema` 投影原 draft 或无 SBI 的 selection_required；隐藏内部元数据、失败分类和主体。只有 adapter 明确报告未发送的 network/retryable 失败可显式 retry 一次；transport maxAttempts:1，queue retryLimit:0。running 重投不重发模型；崩溃或事务异常留下 running 时须先核对结果，不盲恢复。

父只负责共享 index/registry、worker、runtime/env和迁移串行；本卡提供实际工厂与独立 action/query。新迁移必须在852→846之后生成，不手写或修改已合迁移。遵守当前 AGENTS/manifest（集成main后的451ecec），record.js仍b5f267fe；撤销后保留原话附件重新整理新draft，不复活旧draft。

## 依赖、验证与剩余验收

129选择合同已合 main ec691ab、131来源/规则读取已合8e6d520，本分支已append整合，旧606合同与旧read.ts overlay均已移除。实际846 API目前固定组合候选5a77e4c70f0eeab537863fe61a5d6a8ff4276de1；852 lazy producer固定候选e78e5b6788418025b40ddf78bbf5d5adc7eb7f85。候选原blob仅用于本地组合，不属于本PR的新增代码，不冒称已在main。

核心整理、任务栅栏、选人公共投影、来源未决授权和输入绑定均有Red→Green证据。新增真实PG用例覆盖首次并发幂等、选择并发/版本冲突、同键回放、原任务取消、真实pg-boss整体回滚、录音归属保持和846实际writer。缺生成迁移时这些用例硬失败，不跳过或用DDL/fake补表；结果须在迁移协调后实跑。

历史0c4b044固定组合的pnpm check（100文件/912tests）、e2e10/10和visual32/32只证明当时受检范围；不作为本次新增入口的通过证据。当前结果以PR当前head更新为准。

Pending：两表串行生成迁移、202权限适配后的846候选及852共享producer正式整合、当前完整PG/覆盖/构建、共享注册、source-only最小合同及一次化名真实模型验收。本次不调用真实模型/业务API，不配置凭据或部署。PR使用 Refs #37 / Part of BOW-845，不关闭卡；最终合并由父负责。
