# BOW-845：来源片段整理

依据：[SDD/TDD v0.2](https://linear.app/bowenzhong/document/bow-845-共用来源片段整理-sddtdd-v02-8eed25ecd0e9)、[BOW-845](https://linear.app/bowenzhong/issue/BOW-845)、[PR185](https://github.com/bowenQT/QTalent/pull/185)。独立 spec 评审后实现，三个固定化名演示样例见 `examples.ts`，供871与后续 prompt 回归复用；它们不是生产 fallback。

## 已实现的边界

`arrangeRecord(load, client)` 每次调用可信服务器 loader，再走835的 `buildAuthorizedModelInput`。只将本次请求、经授权的 `sources.excerpt` 及必要规则/归属元数据发给模型，不转发 generic fields、整个档案或其余事件。共享来源必须包含完整隐私主体与内容分类；范围外/不存在一律 `not_found`，不调用模型。

`ArrangeSnapshot` 只能由服务端装配，不能从客户端 JSON、缓存角色或已授权页面反序列化。837现有 `talentSources` 供完整主体/分类投影复用；本模块不复制该解析或授权规则。`requestedSources.attributedPersonIds` 是已核实的行为归属，不能从隐私 `subjects` 或候选人列表推导。评分的每条引用都须属于该人；可见团队片段不自动给每个人复制建议分。

模型只产生 SBI 和建议分。服务器保留 draft ID、原话、附件、人员/项目选择、prompt/model/rule/input版本。情境/影响允许空，行为必需；每条引用匹配片段、原件版本、完整位置和精确原文子串。input引用仅允许已授权原话的精确UTF-16偏移。锚点必须匹配当前版本、维度、ID、分值和文本。异常结构/身份/维度/重复评分失败；无效引用或锚点降unknown，保留明确原因。unknown没有数值或伪造来源，且因合同129不含citations，不向846传无可核对的evidence行。

未完成可信个人归属时返回 `selection_required`，保留原话和可见候选供记录人选择，不自动唯一候选指认，不调用模型，也不编造SBI草稿。项目不确定仍按合同保留 `needs_selection`；人名/项目歧义不加入说话人待核对队列。

## 任务及846持久端口

`createRecordArrangeUsecase` 接收842的 `JobStore<C>`，先在行锁下将queued变为running；供应商调用在事务外；最终在同一行锁事务重新验证当前业务写权限、来源授权、输入/规则/归属指纹、attempt/revision与取消栅栏，再调用846的草稿port并写awaiting_manual。重复running投递不再次调用模型，旧attempt与超过2次的attempt拒绝。取消后不提交新草稿，不修改既有事实。

846拟议的 `persistRecordDraft` **尚未发布**，本卡只声明 `DraftPersistence` port。传递字段为id、creatorAccountId、ruleVersionId、draft（不含revision）、sources（含完整subjects）和evidence（person/dimension与真实主引用、modelVersion、rationale、suggestedValue）。rationale缺失保留空；不编确认人/确认时间。promptVersion/modelVersion/inputVersion由本卡持久job result保存，并关联同一draftId；父已确认846的records_draft_events保留eventId→draftId、record_saves也保留draftId，事件由此回溯整理版本，无需扩展846 schema，也不把promptVersion拼入modelVersion。该回调必须使用传入的事务，返回revision=1的同一草稿；不得另开连接或悄悄改写输入。846之后原子生成逐人事件、独立AI建议、人工确认与复核，保存回执沿用 `events[{personId,eventId}]`。

当前main387ad10的参照manifest为已合的 `451ecec`，不自行升级。已核`record.js`仍是b5f267fe，与旧2e51b50相同：撤销保留原话/附件，跳回记事页重新整理，产生新draft；不复活原draft。

内部job result严格持久保存失败分类和attempt预算；public policy只投影合同RecordDraft或null，隐藏元数据与主体信息，读取/控制独立重新授权。只有可信MaaS adapter明确证明未发送的network/retryable失败允许最多一次显式retry。invalid_response/outcome_unknown/cancelled均不自动重发；真实transport组合必须使用maxAttempts:1。独立pg-boss队列retryLimit=0，仍须用数据库claim抵御至少一次投递。

claim后进程崩溃或持久端口事务失败可能留下running。这不证明模型未执行，重复投递只返回ignored。必须先由协调方核对供应商/数据库结果再决定处理，不能盲重置queued或宣称绝不重投。

## 交给父协调的接线片段

以下名称以本卡公开工厂为准，`load*`、`can*`和`persistFrom846`均为待责任方实现的可信端口，不声称已有对应业务API。不得让客户端提供这些依赖。

```ts
const runner = createRecordArrangeUsecase({
  store: createJobStore(db),
  load: loadArrangeSnapshotInTransaction,
  authorize: canRunArrangeInTransaction,
  persistRecordDraft: persistFrom846,
  client: maasWithMaxAttemptsOne,
  now: () => new Date().toISOString(),
});
await registerRecordArrangeJob(boss, runner);

const policy = createRecordArrangePolicy({
  authorize: canCurrentAccountActOnArrange,
  load: loadArrangeSnapshotForCurrentReader,
  currentInputVersion: readArrangeInputVersionInTransaction,
  enqueue: (tx, job) =>
    boss
      .send(
        recordArrangeQueue,
        { jobId: job.jobId, attempt: job.attempt },
        { db: fromDrizzle(tx, sql), retryLimit: 0 },
      )
      .then(() => undefined),
});
```

父负责将policy加入842 registry、注册worker，并复用852拥有的lazy producer和共享环境配置。首次输入持久化/操作幂等与原子首次enqueue也需由相应写端口串行接入。执行和最终提交的loader须使用传入tx装配来源并复用837投影；不能调用837外层独立read-only transaction后声称与草稿提交原子。读取授权不能充当写/重试/取消权限。

selection_required的job为awaiting_manual且public result:null；前置选人消费需要与合同/应用方对齐，本卡不造placeholder behavior来绕过合同。保存完成后的草稿确认不使用jobs resume；选择后或撤销后重新整理应创建新输入版本/新任务和新draft。

## 验证与剩余验收

核心32项、任务编排13项、队列/policy8项先Red后Green；另有unknown evidence接缝的新增回归先Red。真实PostgreSQL测试验证并发claim、取消、持久重试与事务回滚。846未发布的writer在这些测试中替换为同事务合成标记，只证明port事务边界，不代表846业务持久化已验收。

已append整合main387ad10，包含已合PR94@49f11ce和PR77；本轮隔离组合只需PR129@606c4e6fbbb9f8d937c287110d310d3590e1377d的5个record/review-queue合同与专属测试原blob。record/sources/jobs合同相对此前固定407838b9逐字未变，共用port没有改形态。该未合合同不属于本PR交付；无本卡迁移或迁移overlay。此前main29606e7与旧PR129/94的10-blob组合验证保留为历史，不冒充新main证据。最终净diff与CI须129合入后复核。

Pending：846具体writer组合联调、前置选人消费、首次输入与共享入口接线、一次化名真实模型运行及目标模型验收。本轮不调用真实模型/业务API，不配置凭据或部署。PR使用Refs #37 / Part of BOW-845，卡片与issue不关闭；最终合并由父协调方执行。
