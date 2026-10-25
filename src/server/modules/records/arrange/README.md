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
