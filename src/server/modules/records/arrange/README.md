# BOW-845：批次整理的当前交付与接线边界

本分支沿原 PR185 追加，X1 普通同步 `99d5b066be64a4b45c92d5c6b5bf81b61c8fff99` 包含实际 main `27d7da28b887d3e0b8043a7ee3cdd915e67c2d56`。最终897契约为 `e4462114690191fb9cbcd403f6fb0090bd3cfddb`；922分类/时间点读取已在 main，不再使用旧候选接口。本轮普通接回X1共享50fe3bff；846公开writer以cb98cd2固定输入做明确组合验证，不能声称已经在main。旧单草稿生产入口已由下述批次入口替换，原有纯整理器仍有回归测试。

## 当前真实行为

- `prepareBatchSources` 先检查所有请求片段的当前899节点及完整隐私主体权限，再判断取得状态、归属与六类核对依赖。先核完所有片段，避免前一片段未决时暴露后一隐藏片段的存在。未确认人员、项目、范围、说话人或缺失来源依赖均零模型调用；没有把不明事实默认成空数组或无项目。
- 按fragment精确依赖处理核对项。无关片段的未决项不会阻断已可用片段；被保留原件的选中材料不送模型。只处理可信文本、已绑定真实版本的解析片段及完整离线稿。原量表历史面评不转为维度建议；未知上传/录音事实仍不可用，不造转写或默认时长。
- `batch-rules.ts` 实际调用922 `readEffectiveRuleVersion` 和 `readTalentEvaluationRules`，类别固定 `dimension_anchors`，时间固定服务器保存的业务 `boundAt`。按该版本的实际anchor行选维度集合，两个版本字段保留真实rubric版本ID；当前schema没有另一个维度版本表，不创造版本名。选择标准并存、区间相邻/冲突、缺内容均有真实PG回归入口。
- `occurredOn` 保留原事件/来源日期，与业务保存取版时间 `boundAt`、审计墙钟和人工确认时刻分开。后续发布不能替旧输入换版；确认846必须沿草稿版本。
- `record-batch-arrange.v3` 通过843真实Modelink协议接收多个事件；v3离线验证通过；一次真实诊断返回outcome_unknown，未取得可验证输出，第一次真实失败请求使用v2。引用按真实版本、位置、逐字原文与行为归属校验，评分锚点须匹配冻结内容；无效评分降为unknown且去除数值、锚点与引用，不补造来源。模型看不到未选的资料、核对账本或持久草稿ID。
- 一人两件事保留独立草稿；同事件多来源保留来源并集。重复和语义相似仅生成人工候选，保留事件，不自动合并或承诺全库去重。修订依据服务器持久eventKey/ID/witness映射保持身份；不能重命名、交换依据或猜配新增/消失事件。保留旧项目前再次使用当前 `canReadProject` 核权，不因批次默认无项目而清除原归属。
- 模型外发前后重读当前来源、权限、输入、版本及取消栅栏。同操作重放仍重授权；不明发送结果不重发。必须由原生同事务实现operation/job锁、ID分配和写入；内存端口测试不证明跨进程幂等。
- `batch-receipt.ts` 从显式服务器可披露事实派生文件/待确认计数及部分完成状态，再验最终897合同。没有以人数/评分数充当人工确认数量；不虚造hidden/resolved事实。原生文本批次reader现读取当前授权后的846草稿/实际保存回执，再计算部分完成计数；其真实PG测试尚待受控组合执行，不能引用纯投影单测代替。

## 固定样例与验证层级

`batch-fixtures.ts` 提供三份明确化名演示原文：一句话、离线录音cue（1200–4200ms）和附件页2段3。位置属于这些合成样例，不能当实际上传对象/转写/解析的证明；从不安装为生产source fallback。BOW-871可复用这些同一原文与位置。

本轮217项基础测试通过后，补修订项目授权的三项Red，再加可见项目对照后共221项通过；五个私有实现行96.28%、分支97.52%。实际命令为 `node node_modules/vitest/vitest.mjs run`，选择 `batch.test.ts`、`batch-prompt.test.ts`、`batch-validate.test.ts`、`batch-receipt.test.ts`、`record-batch-arrange.test.ts`、`modelink.test.ts`，统一 `--maxWorkers=2`。精确受检提交、后续PG/模型与组合证据以PR当前head的记录为准；不能把工作树测试归给尚未存在的提交。

`batch-rules.integration.test.ts` 使用真实PG、官方已提交迁移、独立随机测试库与实际922 reader；缺测试配置或迁移直接失败，不skip、fake或手写DDL。重检查必须取得heavy槽，没取得就未运行。定向单测和纯回执投影不算PG、原生job、生产E2E或浏览器验证。

## 零调用结构诊断与v3修复

零调用修复阶段从稳定 `2cb9f36a3af7728028b685f18e116e6dbdab7a17` 接回；该阶段未加载凭证、连接PG或发出真实请求，保留原1/1尝试标记。实际843客户端的请求只有 `response_format: { type: 'json_object' }`；传给 `generateStructured` 的Zod对象用于返回后本地验形，不会成为供应商的JSON Schema约束。

离线真实factory配合本地合成HTTP替身先复现两项Red：v2消息没有完整输出schema；也没有区分输入anchor.versionId和输出anchor.ruleVersion。v2只简述suggested/unknown，没有明确state字段和完整嵌套必填形状；“完全匹配给定锚点”又可能引导照抄输入锚点对象，然而输入中的dimensionId/value/versionId不属于输出anchor。**这证明提示词缺口，不能倒推上次未留原响应的具体失败字段。**

最小修复只在本卡私有prompt：v3通过消息传递从实际 `modelBatchSchema` 生成的input JSON Schema，并明确state字面量、SBI四个必填字段及versionId→ruleVersion映射；未改业务schema、正确的共享843客户端、HTTP重试或引用/权限验证。JSON Schema负责可表示的字段/字面量/形状，唯一性、逐字引用、归属和锚点语义仍由原Zod refinements及 `validateBatchModel` 执行，不因提示词变更放行。

离线样例通过实际客户端分别验证：合法suggested/unknown；正文不是JSON；缺sbi.situation；缺/错scores[i].state；照抄输入anchor导致缺anchor.ruleVersion；unknown多出value；缺evidence[i].reference；额外根字段；错误供应商model包装；以及DTO合法但引用伪造。诊断只取本地JSON可解析性与Zod path/code，不记录issue.message、未知字段名、值、原文或头。JSON/业务schema失败在客户端都叫invalid_response，但离线结构诊断可区分；DTO合法后 `validateBatchModel` 拒绝属于business_validation，不伪称有Zod字段路径。该harness只在测试，不是已部署诊断器。

离线验证：新增两项提示词缺口先Red；修复后六目标文件 **234/234**，六私有实现行 **96.31%**、分支 **97.53%**。当时全类型仍只有原先5项旧846依赖诊断，没有新增该提示词片类型错误；限定lint/格式/diff通过。新增的本地HTTP替身运行不计真实请求，旧1/1标记未变。

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

第一请求的usage说明当时包结构已通过，失败范围为正文JSON解析或具体业务Zod校验；未留原始响应，不能认定具体错误字段。v2当时未完整枚举输出字段可能影响结构一致性，不能据此断定真实失败根因；之后v3已补提示词，第二请求却未取得可诊断响应。后续由父按明确验收目的安排，本会话不猜修共享843客户端或自动开始第三次。

当前head CI的实际受检实现a2e2ba0运行41307493598失败于旧846消费的5项类型诊断；E2E/visual跳过。后续文档提交不改受检实现字节，不把上述组件通过写成全仓通过。

## 当前原生文本入口

`record-arrange-requests.ts` 转交本卡 `record-batch-arrange-requests.ts`。已有 action 仍只取服务端 session，输入改为最终897 `MaterialBatchInput`：显式 operationId、evaluationNodeId、personIds、projectId、text、files。旧的无节点 RecordInput/选择planned draft入口明确返回 validation_error，不猜节点或把旧draftId当batchId。当前只支持非空、UTF-8不超过240000字节且files为空的本人新文本。上传/录音的可信来源入口仍明确不可用，不把这些来源伪装为文本。

创建时使用服务器业务时钟冻结 batchId、evaluationNodeId、boundAt、occurredOn 四项原生事实；createdAt仍是审计墙钟。原文完整字节保存在真实original/version/fragment与SHA256中；最终897公开RecordInput按trim规范化，引用DTO同样遵循最终规范。不会为了保留空白恢复旧合同：原文、UTF-16 witness和引用定位分别核对，旧空白断言仍保留并验证当前正确语义。

账户/当前人员绑定、899当前节点关系、每个选中人的写权、明确项目与原文所有已知隐私主体，在本地事务内验证。原件版本/片段、唯一jobSnapshots、arrangeInputs、请求幂等键、审计和实际pg-boss发送同事务提交。发送使用852既有producer与 `fromDrizzle(tx,sql)`，队列retryLimit为0。没有人员时保存真实unknown_person待核对项，不调用模型、不入846草稿；后续核对/undo依赖905真实处理入口，本片没有成功替身。

`record-batch-arrange-state.ts` 只把真实job状态映射为本卡运行态，持久metadata不再存第二份phase或draftSet。唯一job result保存actor身份、操作号、prompt/model、双版本、输入指纹、源日期与eventKey→draftId→真实witness映射。草稿内容与人工保存回执从846原生账本读取，不在job里复制。

`createRecordArrangeApplication` 组合实际842锁/控制服务、实际922 reader、本卡准备/校验和846 `storeTrustedRecordDraftBatch`。模型外发前先锁job/input/当前身份与来源依赖，转running后释放数据库事务；模型在事务外执行。返回时重新锁定和读取当前完整来源graph、原件/hash、人物节点/关系、规则、输入及取消栅栏。初次ID分配、实际846草稿insert、job manifest/result在同一原生事务完成；任何一步失败均回滚初次草稿，原话保留。重复投递或running重投不再次请求模型，outcome_unknown不允许显式重试。

本片只用846初次insert API。原生版本CAS尚未提供时，不把再次insert当修改；批次修订仍不可用。源码中修订算法的离线测试不等于生产修订已接。

共享worker的唯一生产组合入口为本卡 `createRecordArrangeWorker`（`usecases/record-arrange-worker.ts`）。它复用实际Modelink客户端，固定 maxAttempts=1、单次30秒/总45秒、8192输出token和1MiB响应预算；只使用传入的三个Modelink字段，既不读凭证文件，也不创建另一套boss/数据库池。缺失凭证或不支持的endpoint/model在请求发送前失败。X1共享入口最小注册如下：

```ts
await createRecordArrangeWorker({
  db: getDatabase(),
  boss, // startWorker已有的同一个实例
  environment: {
    MODELINK_API_KEY: env.MODELINK_API_KEY,
    MODELINK_BASE_URL: env.MODELINK_BASE_URL,
    MODELINK_MODEL: env.MODELINK_MODEL,
  },
  businessNow: () => clock.now().toISOString(),
  now: () => new Date(),
}).register();
```

当前共享 `src/worker/index.ts` 尚未注册以上调用，由X1独占写入。现有842控制服务在本卡requests里直接使用实际native policy；请求侧复用852唯一lazy producer。共享worker沿原有stop路径收尾，无需新增启动服务。实际factory与本地合成HTTP组合测试仅证明客户端/业务/PG组合，不算真实供应商调用。

## 本轮验证与剩余范围

原生作者检查点b000的12文件263项离线通过；8条旧空白预期先实际Red，再保留案例并按最终合同修正。X1组合 **d44b4f01e07eab01550e0d7bff8c82c7586c6842** 普通合入b000、846固定cb98cd2和main71f8d9，已由X1实跑typecheck零错误及原生requests **26/26 PG通过**（#248/6560272701），解除旧9项缺846依赖的类型诊断。该证据属于此固定组合，不覆盖846活动R2或全仓门禁。

本轮B1只格式化native.ts；新增私有worker工厂的7项定向离线测试通过，证明固定协议/预算、构造不发送、缺配置拒绝、发送前失败不自动重试、30秒超时outcome_unknown和响应体上限。受影响的原生PG测试改为实际消费这个工厂，并仅记录合成请求JSON字节数，精确提交和最新实跑结果见PR记录；此前d44测试不能直接称为新增接线通过。

`record-arrange-requests.integration.test.ts` 覆盖真实pg-boss事务/消费、实际846初次写入、当前撤权/改绑/跨节点graph、取消、输入与source篡改、并发幂等和真实唯一键回滚。测试仅用正式迁移加X1由schema原生生成的受控临时目录，缺表硬失败，不skip、不手写DDL或fake数据库。测试库只从test-db.env向子进程白名单注入TEST_DATABASE_URL；不用vendors.env，不打印连接信息。临时目录通过QTALENT_845_TEST_MIGRATIONS显式传入，不改变正式CI迁移或冒称最终0009。

| 本PR代码依赖                     | 当前实际边界                                                                                             |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 最终897、899、922、842、843、852 | 已消费实际合同/公共API；最新main普通同步与全仓检查仍须实际验证                                           |
| 846固定cb98cd2                   | 真实store、草稿/保存表与当前source projection；已接X1组合d44；仍待846最终R2/main，不能以固定cb98结果替代 |
| X1四事实schema/出口50fe3bff      | 已普通接回；最终迁移顺序846→845→873，临时迁移仅隔离验证                                                  |

| 卡片剩余范围依赖                               | 明确未完成                                                                                                                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 846人工保存与新文本来源selector                | cb98只从正式event/history构建来源主体；确认前新文本没有event。须由846/X1读取并验证真实845 intake sourceContexts，不能插假event或只用draft.personIds反推完整主体。详见#248/6559264101 |
| 846批次修订CAS                                 | 需校验预期批次/草稿revision、稳定身份与人工保存栅栏，同事务替换；insert-only不支持                                                                                                   |
| 905核对/撤销与873/859/866实际取得              | 未决来源保持待核对/不可用；不伪造resolved、材料成员、说话人、时长或来源事实                                                                                                          |
| X1共享worker/registry与迁移                    | 作者提供固定预算实际worker工厂；共享生产注册、最终迁移/整合main尚未验                                                                                                                |
| 生产身份、人工确认、浏览器与实际供应商业务联验 | 原生PG组合、Node组件、纯回归、供应商请求分别记录，不冒生产E2E                                                                                                                        |

两次真实模型尝试记录与排他标记保持。当前窗口零真实请求。下一次最小成功验收建议：先在已通过原生PG/固定实际factory组合上，仅用一份已经明确授权的化名文本，冻结业务日期与真实rubric、计算单次JSON字节，maxAttempts=1和上述30秒/45秒/8192token/1MiB配置；事先明确只检验请求→返回→本卡逐字引用/归属/双版本→隔离AI草稿，不执行人工确认或生产写入。实际请求规模和准入条件在PG稳定后另交父，不自动重发前次outcome_unknown。

继续Refs #37 / Part of BOW-845，Draft且不关闭整卡。最终合并只由获授权的Claude编排执行。
