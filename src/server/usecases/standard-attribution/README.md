# 标准归因与 AI 起草用例（BOW-921）

基线 main `5726fd5d0cd6457d762327829adc002b1dda41b3` 已包含 BOW-917（原受审冻结 `832209d177944b5ce18577794acb88314a6460da`）。原#273交付用例与提示词；当前续作在main71f8d9及X1固定d0caef9306f60d0f2061f0fec5d8aac921c0e20e结构上新增四表原生适配。919生产canonical读取、918基准读取、HTTP入口和最终迁移仍待接通。

## 三个用例

`createStandardAttributionUsecases(ports, model, { now, newId })` 提供：

- `generateHypotheses(accountId,input)`：当前HR身份和批次范围由服务器端口解析，候选案例先按当前两段均可披露的ID过滤，再用917契约校验已确认事实/对应表。模型只收到这个最小快照；只可引用快照中的caseId/side，实际原表行和版本由服务器解析，最终用917 grounded schema校验。成功无假设返回 `success / []`，调用或输出失败为 `model_failed`，不生成HR归因或修订。
- `confirmAttribution(accountId,input)`：支持五类、多选、理由及当前引用；签名人和时间由服务端产生。可以不关联AI假设，关联时仍核当前引用。只保存 `human_conclusion`；「本人或环境变化」不会自动起草或改标准。
- `draftSelectionProposal(accountId,input)`：只有当前HR已确认、修订号匹配且含 `evaluation_standard` 的归因才能调用模型。基准版本须为明确的入营选拔标准，AI增删改必须匹配实际评审要点，不允许伪造before、重复ID或删光要点。输出是独立 `SelectionDraftProposal`，含 `aiDraft / origin:ai_draft`、已确认归因、提示词/模型追踪、`humanVersion:null`。它不是918的已创建/发布修订，不覆盖真实HR编辑。

所有输入复用917严格schema；无人才总分、排行、准确率/能力百分比或档案写入。后一阶段不是正确答案，缺段/未知/不可比不当作反向证据。案例原文是数据，不是模型指令。提示词版本分别为 `selection-attribution-hypotheses-v1` 与 `selection-attribution-draft-v1`。

## 当前授权与一次操作

`loadHrBatch` 必须由真实认证身份、HR项目范围与当前节点关系构造；过去参加前段不是两段读取授权。`loadDraftContext` 必须先解析归因→批次→当前HR范围，再读取私有归因和基准内容。任何无法解析的范围失败关闭，不提供allow-all默认值。

模型调用前在端口事务中锁actor/operation，当前授权后检查语义指纹和证据快照，再持久化pending预留；模型调用在事务外。返回后再次加载当前权限、引用/版本与基准，变化则不给出或保存AI结果。成功成果、审计和最终操作回执须在同一原生事务提交；存储/审计异常向调用者传播，不冒充模型失败。

同操作同语义且证据未变可授权重放，不二次调用模型；同key改语义、pending/未知结果或较新预留栅栏冲突。已记录的模型失败重放仍失败；明确的新尝试须使用新操作编号。进程在外部调用后中断时保留pending，不能据此盲目重提付费请求；生产适配须提供有证据的人工收口策略。缓存业务结果不绕过当前授权。

## 接线边界

- 原用例测试中的事务存储仍只是边界替身。新增 `createAttributionPostgresStore` 提供真实四表实现，必须显式注入可信919/918 reader，没有默认生产reader；原生验证与未接范围见下节。
- 843公共Modelink客户端尚未合入时，仅通过结构化客户端的最小接口注入；真实组合应使用其 `MODELINK_MODEL` 与公开工厂，模型及提示词元数据须匹配，不复制HTTP/SDK。缺配置不妨碍人工归因。
- 919须提供当前授权、人类已确认、两段可披露的案例事实；不从923的expected读取输入事实。
- 918目前创建事实不接AI提案。需由其明确writer提供服务器内部接入口：校验相同归因/基准及内容修订，保留AI原稿，真实HR保存才生成hr_edited；已有人编辑时不能被迟到AI覆盖。921不直接改其模块/usecase/schema。
- 四表由X1共享结构提供，本目录实现原生适配；正式迁移仍由X1按游标生成，未提交临时SQL。生产HTTP/三入口接线仍待919/918真实读取组合；历史单次模型证据见下，不代表本轮原生业务联调。

## 当前验证

Node24.21.0 / pnpm11.25.0：

```sh
pnpm test --maxWorkers=2 src/server/usecases/standard-attribution/hypotheses.test.ts
pnpm test --maxWorkers=2 --coverage --coverage.include='src/server/usecases/standard-attribution/**.ts' --coverage.exclude='src/server/usecases/standard-attribution/**.test.ts' src/server/usecases/standard-attribution/hypotheses.test.ts
pnpm typecheck
pnpm lint
```

57项专属测试通过；定向行99.45%、分支96.61%、语句98.52%、函数98%。这是本目录覆盖率，不是全工程统一结果。测试覆盖过滤后输入、五类归因、标准归因门槛、AI/HR分离、[]、模型失败、伪引用/伪编辑、操作并发/重放、调用中撤权/事实变更和持久端口失败传播。完整重检查和真实供应商结果以PR精确SHA证据为准；自动测试不访问真实服务、不加载凭证。

## 单次真实模型证据

2026-10-31 19:20:59.736Z–19:21:11.281Z，在macOS / Node24.21.0显式运行纯合成验证。用例代码固定 `239507597e133e5c482a258dbc77e33968ebd337`，公共843客户端固定 `d688c92eed320102d099ecc1f4af74f50298f32e`；这是已验客户端的独立组合，不表示843或生产组合已合入。

服务Modelink，接口 `https://api.modelink.ai/v1/chat/completions`，模型 `google/gemini-3.8-flash`，提示词 `selection-attribution-hypotheses-v1`。当前短时合成授权仅含 `demo-comparison-1`，另一个合成范围外案例在发出前被过滤；请求内容SHA-256为 `a1e8aa4a441d63bfccfb621912f59203e0fe8751e432937d51eb28e3cb316fb4`。仅source所有者指定vendors.env，未读取输出或保存凭据值。

- HTTP200；实际HTTP调用1次、SDK attempts=1，耗时11533ms，无重试。
- requestId `chatcmpl-1a397ac843c74a08bedac2cb89a1bff6`；usage 1022/1224/2246（prompt/completion/total）。供应商未返回费用数字。
- SDK结构与本用例引用校验均通过，结果success，生成1条 `ai_hypothesis`，类别 `method_or_information / person_or_environment`，引用仅该合成案例的前/后两段实际行。人工结论0、业务修订/发布0、数据库写入0。

验证只有内存端口和合成当前权限，不证明生产HR/node身份、919实际查询、918接入、原生事务或页面。真实证据覆盖假设生成；AI修订提案与五类HR归因的行为由专属离线测试验证，不把它们称作真实业务操作。生成的假设没有被冒充人工结论，也未触发标准修订。完整脱敏结果在PR记录，未保存原始模型响应或供应商配置。

## 原生四表续作

`createAttributionPostgresStore(db, services)` 返回完整 `AttributionPorts<AttributionTransaction>`，用于既有 `createStandardAttributionUsecases`。`AttributionTransaction` 仅由工厂的活跃事务签发，不接受过期/跨工厂/错误账号或operation的令牌。

- Read Committed；先锁账号+operation的advisory键，再以共享行锁读取当前账号绑定，缺失/管理员拒绝。账本保存actorPersonId，模型期间重绑后不能完成或重放原人的操作。权限仍由真实899 loader读取。
- pending持久提交后才调用模型；完成时同reservationId、fingerprint、evidenceFingerprint CAS，finished不允许覆盖。崩溃后pending明确冲突，不自动重复模型收费。操作可跨工厂重放原成功回执，仍先核当前权限与证据。
- AI假设、HR归因、AI提案分表不可变追加；人工确认每次新id/revision1。归因的假设必须同batch，提案basis必须逐字段等于持久归因并匹配精确revision、baseVersion目录外键。无hr_edited/发布写入。
- 成果、原审计recordAudit与ledger在同一事务。适配器核成果与回执一致、审计action/batch/actor一致，遗漏audit/ledger令事务失败。真实审计插入后、回执更新后故障均回滚成果与审计；此前模型pending仍保留。
- 使用真实执行时钟记录ledger创建/完成；业务授权使用用例传入的明确at，模型时钟/演示业务时钟不充当数据库锁超时。

`AttributionReadServices` 是必须显式提供的实际数据读取边界：

1. `readCanonicalComparisonBatch(tx,batchId)` 返回919的 `ComparisonDataset | null`。null仅表示真实不存在；未接/存储故障须抛错，不得返回空数组。它必须校验真实原件行、版本和canonical归属；不能读923 expected或返回预计算outcome。
2. `readSelectionStandard(tx,versionId)` 返回精确基准的 `{version,content} | null`；沿918固定实现接真实内容。错误类别/版本/无效内容拒绝，不从生效元数据猜正文。

读取适配由真实899 `loadEvaluationContext` 构造HR目录署名，先核批次期次HR，再逐人逐段核 `canManageNodeAssignments`、evaluation source-read/model-input；评价关系不补HR范围。以919 `projectComparison` 从原事实计算授权案例，不复制算法。canonical异步IO之后重读身份/范围；归因→batch先授权，再读私有归因及基准，基准等待后再核范围与精确引用。两个真实PG撤权反例先Red再修。读取中的未知存储错误继续抛出。

**当前生产缺口**：919 canonical writer尚未交稳定生产reader，918#269未合且该精确基准读取组装未完成；本PR只在测试中明确提供合成canonical/918事实，权限、四表、锁、审计和回执走真实PG。两段节点使用合法合成类型，不表示923真实selection/graduation的kind裁决已完成。完整原件权限/实际原表打开仍须919及原件读取链保证，本适配的节点过滤不冒充原件字节访问验收。未接生产HTTP/query/模型组装，不宣称第三幕在线。

### 本轮验证

- 25真实PG + 15读取适配单测 + 原57用例 = **97/97**，无skip。单次coverage统一统计新两个生产文件：行178/189（94.17%）、分支181/206（87.86%）、语句191/215（88.83%）、函数39/39。保持85%门槛，不称全仓覆盖。
- 真实PG包括同key跨连接只写一次、新实例重放、pending不二次模型、三重CAS、真实等锁后撤权、到期、模型期间重绑/撤权、审计和回执晚失败回滚、错误revision/基准/跨批/basis、合法空假设。供应商是纯合成结构化响应，无真实网络模型调用。
- 运行：`node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts --maxWorkers=2 src/server/usecases/standard-attribution/postgres.integration.test.ts src/server/usecases/standard-attribution/read-adapter.test.ts src/server/usecases/standard-attribution/hypotheses.test.ts`；coverage显式include postgres.ts/read-adapter.ts。
- 测试只source所有者指定test-db.env，白名单子进程只收TEST_DATABASE_URL和固定参数。随机本机_test库，afterAll删除本人库。真实PG先CAS领heavy槽、结束按token释放；没有新PG服务。
- 四表在正式迁移 0011；测试固定读取 `src/server/db/migrations`，原临时迁移目录变量已退役。
- 当前0/2，新的独立Draft PR，#273已合历史不重开。卡片仍Part of BOW-921；源码/结构与最终迁移、真实reader、整链验收分别记录。
