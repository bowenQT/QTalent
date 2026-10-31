# 标准归因与 AI 起草用例（BOW-921）

基线 main `5726fd5d0cd6457d762327829adc002b1dda41b3` 已包含 BOW-917（原受审冻结 `832209d177944b5ce18577794acb88314a6460da`）。本目录只实现可提前开发的用例、提示词与明确端口；不实现919查询、918生命周期、数据库表、HTTP入口或生产依赖配置。

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

- `AttributionPorts` 没有生产默认实现。测试中的事务存储是外部边界替身，验证真实用例的输出/调用顺序和失败传播，不代表PostgreSQL锁、回滚、撤权竞态或重启已经验收。生产适配须使用Read Committed、操作锁、锁后当前权限/时间和同事务审计/回执。
- 843公共Modelink客户端尚未合入时，仅通过结构化客户端的最小接口注入；真实组合应使用其 `MODELINK_MODEL` 与公开工厂，模型及提示词元数据须匹配，不复制HTTP/SDK。缺配置不妨碍人工归因。
- 919须提供当前授权、人类已确认、两段可披露的案例事实；不从923的expected读取输入事实。
- 918目前创建事实不接AI提案。需由其明确writer提供服务器内部接入口：校验相同归因/基准及内容修订，保留AI原稿，真实HR保存才生成hr_edited；已有人编辑时不能被迟到AI覆盖。921不直接改其模块/usecase/schema。
- 私有假设、HR归因、AI提案、操作预留/回执与审计的持久适配需与918/919/X1协调。本目录没有新表或迁移，没有冒充已经生产落库。生产HTTP/三入口接线与一次真实模型验证仍单独记录。

## 当前验证

Node24.21.0 / pnpm11.25.0：

```sh
pnpm test --maxWorkers=2 src/server/usecases/standard-attribution/hypotheses.test.ts
pnpm test --maxWorkers=2 --coverage --coverage.include='src/server/usecases/standard-attribution/**.ts' --coverage.exclude='src/server/usecases/standard-attribution/**.test.ts' src/server/usecases/standard-attribution/hypotheses.test.ts
pnpm typecheck
pnpm lint
```

57项专属测试通过；定向行99.45%、分支96.61%、语句98.52%、函数98%。这是本目录覆盖率，不是全工程统一结果。测试覆盖过滤后输入、五类归因、标准归因门槛、AI/HR分离、[]、模型失败、伪引用/伪编辑、操作并发/重放、调用中撤权/事实变更和持久端口失败传播。完整重检查和真实供应商结果以PR精确SHA证据为准；自动测试不访问真实服务、不加载凭证。
