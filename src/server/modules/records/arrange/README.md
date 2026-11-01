# BOW-845：批次整理的当前交付与接线边界

本分支沿原 PR185 追加，X1 普通同步 `99d5b066be64a4b45c92d5c6b5bf81b61c8fff99` 包含实际 main `27d7da28b887d3e0b8043a7ee3cdd915e67c2d56`。最终897契约为 `e4462114690191fb9cbcd403f6fb0090bd3cfddb`；922分类/时间点读取已在 main，不再使用旧候选接口。下半部保留10/25单草稿历史说明，其中旧 writer、全表取版与旧候选验证不能代表本次多事件接线。

## 当前真实行为

- `prepareBatchSources` 先检查所有请求片段的当前899节点及完整隐私主体权限，再判断取得状态、归属与六类核对依赖。先核完所有片段，避免前一片段未决时暴露后一隐藏片段的存在。未确认人员、项目、范围、说话人或缺失来源依赖均零模型调用；没有把不明事实默认成空数组或无项目。
- 按fragment精确依赖处理核对项。无关片段的未决项不会阻断已可用片段；被保留原件的选中材料不送模型。只处理可信文本、已绑定真实版本的解析片段及完整离线稿。原量表历史面评不转为维度建议；未知上传/录音事实仍不可用，不造转写或默认时长。
- `batch-rules.ts` 实际调用922 `readEffectiveRuleVersion` 和 `readTalentEvaluationRules`，类别固定 `dimension_anchors`，时间固定服务器保存的业务 `boundAt`。按该版本的实际anchor行选维度集合，两个版本字段保留真实rubric版本ID；当前schema没有另一个维度版本表，不创造版本名。选择标准并存、区间相邻/冲突、缺内容均有真实PG回归入口。
- `occurredOn` 保留原事件/来源日期，与业务保存取版时间 `boundAt`、审计墙钟和人工确认时刻分开。后续发布不能替旧输入换版；确认846必须沿草稿版本。
- `record-batch-arrange.v3` 通过843真实Modelink协议接收多个事件；v3只做过离线验证，历史真实失败请求使用v2。引用按真实版本、位置、逐字原文与行为归属校验，评分锚点须匹配冻结内容；无效评分降为unknown且去除数值、锚点与引用，不补造来源。模型看不到未选的资料、核对账本或持久草稿ID。
- 一人两件事保留独立草稿；同事件多来源保留来源并集。重复和语义相似仅生成人工候选，保留事件，不自动合并或承诺全库去重。修订依据服务器持久eventKey/ID/witness映射保持身份；不能重命名、交换依据或猜配新增/消失事件。保留旧项目前再次使用当前 `canReadProject` 核权，不因批次默认无项目而清除原归属。
- 模型外发前后重读当前来源、权限、输入、版本及取消栅栏。同操作重放仍重授权；不明发送结果不重发。必须由原生同事务实现operation/job锁、ID分配和写入；内存端口测试不证明跨进程幂等。
- `batch-receipt.ts` 从显式服务器可披露事实派生文件/待确认计数及部分完成状态，再验最终897合同。没有以人数/评分数充当人工确认数量；不虚造hidden/resolved事实。此投影尚未接生产批次reader。

## 固定样例与验证层级

`batch-fixtures.ts` 提供三份明确化名演示原文：一句话、离线录音cue（1200–4200ms）和附件页2段3。位置属于这些合成样例，不能当实际上传对象/转写/解析的证明；从不安装为生产source fallback。BOW-871可复用这些同一原文与位置。

本轮217项基础测试通过后，补修订项目授权的三项Red，再加可见项目对照后共221项通过；五个私有实现行96.28%、分支97.52%。实际命令为 `node node_modules/vitest/vitest.mjs run`，选择 `batch.test.ts`、`batch-prompt.test.ts`、`batch-validate.test.ts`、`batch-receipt.test.ts`、`record-batch-arrange.test.ts`、`modelink.test.ts`，统一 `--maxWorkers=2`。精确受检提交、后续PG/模型与组合证据以PR当前head的记录为准；不能把工作树测试归给尚未存在的提交。

`batch-rules.integration.test.ts` 使用真实PG、官方已提交迁移、独立随机测试库与实际922 reader；缺测试配置或迁移直接失败，不skip、fake或手写DDL。重检查必须取得heavy槽，没取得就未运行。定向单测和纯回执投影不算PG、原生job、生产E2E或浏览器验证。

## 零调用结构诊断与v3修复

零调用修复阶段从稳定 `2cb9f36a3af7728028b685f18e116e6dbdab7a17` 接回；该阶段未加载凭证、连接PG或发出真实请求，保留原1/1尝试标记。实际843客户端的请求只有 `response_format: { type: 'json_object' }`；传给 `generateStructured` 的Zod对象用于返回后本地验形，不会成为供应商的JSON Schema约束。

离线真实factory配合本地合成HTTP替身先复现两项Red：v2消息没有完整输出schema；也没有区分输入anchor.versionId和输出anchor.ruleVersion。v2只简述suggested/unknown，没有明确state字段和完整嵌套必填形状；“完全匹配给定锚点”又可能引导照抄输入锚点对象，然而输入中的dimensionId/value/versionId不属于输出anchor。**这证明提示词缺口，不能倒推上次未留原响应的具体失败字段。**

最小修复只在本卡私有prompt：v3通过消息传递从实际 `modelBatchSchema` 生成的input JSON Schema，并明确state字面量、SBI四个必填字段及versionId→ruleVersion映射；未改业务schema、正确的共享843客户端、HTTP重试或引用/权限验证。JSON Schema负责可表示的字段/字面量/形状，唯一性、逐字引用、归属和锚点语义仍由原Zod refinements及 `validateBatchModel` 执行，不因提示词变更放行。

离线样例通过实际客户端分别验证：合法suggested/unknown；正文不是JSON；缺sbi.situation；缺/错scores[i].state；照抄输入anchor导致缺anchor.ruleVersion；unknown多出value；缺evidence[i].reference；额外根字段；错误供应商model包装；以及DTO合法但引用伪造。诊断只取本地JSON可解析性与Zod path/code，不记录issue.message、未知字段名、值、原文或头。JSON/业务schema失败在客户端都叫invalid_response，但离线结构诊断可区分；DTO合法后 `validateBatchModel` 拒绝属于business_validation，不伪称有Zod字段路径。该harness只在测试，不是已部署诊断器。

离线验证：新增两项提示词缺口先Red；修复后六目标文件 **234/234**，六私有实现行 **96.31%**、分支 **97.53%**。全类型仍只有原先5项旧846依赖诊断，没有新增本片类型错误；限定lint/格式/diff通过。新增的本地HTTP替身运行不计真实请求，旧1/1标记未变。

## 第二次诊断边界与实际结果

1. 输入冻结为本次稳定v3提交，三份既有化名原文、实际899当前授权及922真实取版；846继续固定已验输入，另建明确组件组合，不声称main/生产接线。调用前检查源码SHA/洁净树、最小授权片段、业务boundAt/原日期、模型配置和线包字节预算。不读其他凭据源，不更改模型/端点。
2. 新预算必须明确批准为**最多1次**，不重置原1/1账本。批准后才创建新的排他尝试标记，用实际factory、maxAttempts=1、30秒单次/45秒总预算、8192输出token、1MiB响应上限；抓取计数最多1。取消、超时、错误或不明结果均结束本次，不自动重发，也不修后再试。
3. 在真实fetch的同一响应旁路做有界内存诊断，所有分支共用取消/超时，额外读取也最多1MiB。持久化前仅投影结构：包/正文JSON是否可解析；白名单字段的类型；model/role/finish_reason等协议字面量是否匹配；具体业务Zod路径、错误码及接收类型。最多32条、深度/节点有上限；未知键统一占位符，不存未知原键、issue.message/input/完整union错误对象、值、原文、原头或完整响应。包/正文只在有界内存解析后丢弃，不落盘；精确请求标识仍只受控/私有Linear。
4. 分类按实际阶段：配置未发送；传输/HTTP失败或outcome_unknown；envelope_json/envelope_schema；body_json；model_schema（安全Zod path/code）；business_validation；或通过。若包和DTO通过再运行真正的 `validateBatchModel`/materialize，只记录通过/拒绝和合成计数，不复制校验算法来制造更细原因。模型结果不写业务库。
5. 每个终态都立即退出、清理线程/PG与合法重测槽，保留尝试标记。一次取得结构证据即交回，不以取得成功答案为退出条件。以下记录所有者明确确认后执行的结果；本会话不自行启动第三次。

所有者明确确认后，按上述边界在固定清洁提交 `f39d6a3acf130da3cf24a32119a5765f3c809050` 实际执行第二次请求：本次1请求/1尝试、30.014秒，返回 **outcome_unknown**，无可诊断响应、无第二次请求标识。当前结构投影为空，不能推断具体JSON/schema字段错误，也不能宣称v3模型输出验证通过；无法确认供应商是否已处理或计费。**本次1/1预算已用尽并停止，第一次1/1记录不重置，累计2次；未重试。**

执行前，本轮受控结构读取器12项离线检查通过，涵盖字段/路径白名单、未知键占位、1MiB预算、预取消/运行取消及实际factory的响应字节保持。调用进程重新读取899原生合成授权、三份实际入库化名原文及922实际规则，原日期/真实双版本保持；没有把客户端自报权限当事实。实际参数为maxAttempts1、30秒单次/45秒总、8192token、1MiB响应；只有原生fetch的同一响应旁路，不改共享client/schema。响应未取得，未执行成功后的 `validateBatchModel`/materialize；未存模型结果、完整响应、原文、请求头、未知键值或issue.message。随机测试库/连接和合法重测槽均已清理，两个排他标记保留。受控结果只保留运行事实和结构投影；无响应可验形是本次的实际限制，不以付费重发补证据。

[rvw2对f39d6a3的组件审查](https://github.com/bowenQT/QTalent/pull/185#issuecomment-6558419087)已通过本片范围，修改0/2历史保持。该审查另发现继承的record-verbatim/arrange测试有8项与最终897首尾空白trim合同冲突；和原5项旧846类型诊断、生产writer/job/账本接线一起仍待整卡收口。此诊断窗口没有改共享契约、删旧测试或声称这些问题已解决。

## 先前组件及第一次模型记录（v2）

受检实现 `a2e2ba00727845a4c3269d51a997e945a60be048`：六目标文件221/221，加入fixtures后六个私有实现行96.30%、分支97.53%。官方main迁移和实际922 reader的6项真PG全部通过，reader行/分支100%；未执行完整check或生产E2E。

独立清洁组合 `3b0b72064e5c14fc21b3ca690bffa78fd4acbebb` = 上述实现 + 846固定 `1f733d49c5ffe9cfa877563ffd251e973922b0ae`。受控手动脚本导入实际源码，使用899原生授权loader、实际入库的三份化名原文、922实际取版和846公开writer；三草稿逐字段存取、原日期与真实双版本、重复insert拒绝及事务回滚通过。测试库均已删除。这里不代表生产请求loader/job/去重账本接通、人工确认或浏览器E2E通过。

一次真实模型运行：实际Modelink factory，`google/gemini-3.8-flash`，`record-batch-arrange.v2`，maxAttempts=1；输入仅三份明确已授权化名样例与真实读取的合成规则，业务取版时刻来自实际 `createClock('local')`，原日期仍2026-09-03。请求返回 **invalid_response**，21.537秒，1次请求/1次尝试，890输入和2497输出token。精确非秘密请求标识只留受控记录；未保存模型结果、未生成可接受草稿，没有成功后的原文/归属/版本校验通过声明。**第一次预算1/1已用完，其记录保持，不重发该次请求。**

包结构校验后才会记录usage，因此当前失败范围为正文JSON解析或具体业务Zod校验；未留原始响应，不能认定具体错误字段。prompt尚未枚举完整输出字段可能影响结构一致性，只是待证假设。若要进一步真实诊断，另需明确新请求预算及安全结构诊断方案；不在本轮猜修共享843客户端或再发请求。

当前head CI的实际受检实现a2e2ba0运行41307493598失败于旧846消费的5项类型诊断；E2E/visual跳过。后续文档提交不改受检实现字节，不把上述组件通过写成全仓通过。

## 原生接线仍需完成

846真实入口是 `storeTrustedRecordDraftBatch(tx,{draftSet,originalInput,occurredOn,modelVersion,createdByAccountId,createdAt})`，初次insert；旧185的 `persistRecordDraft` 不是这个入口。固定846输入 `1f733d49c5ffe9cfa877563ffd251e973922b0ae` 可用于明确组合验证，不能称已在main。需要追加版本CAS时由846提供真实API，不复制旧writer。

当前 `arrangeInputs` 没有明确batchId/evaluationNodeId/业务boundAt/occurredOn；select创建新input.id，旧planned draftId不能猜作稳定批次。`createdAt` 是审计墙钟，不能当demo业务取版时间。X1共享schema/出口/迁移窗口请求见 [协调索引6557880321](https://github.com/bowenQT/QTalent/issues/248#issuecomment-6557880321)：新事实对历史行保持不可用，不猜填；复用唯一job状态/result保存trace、双版本和eventKey/ID/witness账本，与846草稿初次写入原子提交。模型前后都需原生loader重授权，不能用旧缓存的可读标志。

还需当前批次六类review/resolved/hidden、来源完整归属、取得版本及实际writeAllowed的原生读取，以及852唯一producer/worker注册。共享schema、公共出口、注册、最终迁移只由X1修改。当前5个全类型诊断均来自未合846缺失模块及其继承类型；不得用旧846候选补洞或删调用冒通过。

最新所有者串行顺序为 **846 → 845 → 873**。873不阻断已支持文本/真实取版/846草稿writer的独立验收；真实上传/音频缺事实时只对相应材料保持不可用。整卡要求writer、持久化与job接线，以上独立交付不能擅自缩减完成条件，继续 `Refs #37` / `Part of BOW-845`，Draft且不关闭。

---

> 以下为历史单草稿设计与证据，不代表当前冻结合同或已经完成的接线。

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
