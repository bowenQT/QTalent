# BOW-871 合同与权限回归骨架

本目录是提前起跑的独立回归骨架。**不代表八条合同、越权矩阵或决赛链路已通过验收。** 不改业务实现、根测试配置或公共夹具。未具备实现的场景列为待接线，不创建 `skip`、`todo`、空断言或仅断言 mock 自身的用例。

输入版本：

- 既有骨架 main 基线：`dc53fbe54179281b5bee37877aba7795eea3a4d1`。
- 采集与出处冻结：897 `0b20a913621121848219e0966ba4bf4844d1bdb3`；入口见该提交的 `src/contracts/{sources,materials,material-review,record}.ts`。
- 标准迭代冻结：917 R2（替代da3012e；本工具只验证契约） `832209d177944b5ce18577794acb88314a6460da`；入口见该提交的 [standard-iteration.md](https://github.com/bowenQT/QTalent/blob/832209d177944b5ce18577794acb88314a6460da/src/contracts/standard-iteration.md)。

验收依据：[BOW-871](https://linear.app/bowenzhong/issue/BOW-871) 的 10/31 第三轮与执行入口，以及[架构提案 6.2](../../../docs/proposals/2026-10-25-y-architecture-phases.md#62-必须守住的八条合同)。合入须满足 #63 全部 blocked-by 已进 main；关闭须全部回归在 main 通过。

## 当前可执行的检查

| 文件                               | 真正调用的 main 实现                                                                        | 能证明的范围                                                                                                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authorization-regression.test.ts` | `readTalentCollection`、`readTalentRecord`、`readTalentSource`、`buildAuthorizedModelInput` | 四角色读取与过滤后计数；越权 ID 与不存在 ID 同样不可见；片段/原件版本配对；混合主体的引用及推断字段整体隐藏；每次重新加载权限；授权/关系左闭右开到期；绩效材料不进入模型输入                            |
| `profile-regression.test.ts`       | `personFromData`、`sourceFromData`                                                          | 可见分数的锚点/规则/评价人与可打开引用；导师响应没有象限字段；系统管理员不可读；AI 推断与人工摘要/时间线分区；失效出处不出分；演示快照不冒充真实原件；当前档案 DTO 不含总分/排名/百分比/confidence 字段 |
| `frozen-contracts.verify.ts`       | **各冻结 SHA 的真实 schema**，在独立 worktree 中读取                                        | 出处定位负例、面评历史类别、未分配批次、两表来源独立、同一行号跨表合法、管理者严格响应、按类别取版输入、期次不换版、未编辑草稿/空假设、配对撤销合同、姓名稳定顺序及分布拒绝负例等**契约校验**           |

前两组是无数据库、无网络的离线公共入口组合验证，不是 HTTP / 持久化 / 浏览器端到端验收。`fixtures.ts` 只提供合成存储快照，不实现授权、投影或模型流程；有效断言调用上表的真实业务入口。模型输入检查不调用模型，不证明真实供应商或实际外发链路已通过。

main 当前的 `TalentSubject` 没有 `nodeId`；这里的角色/关系到期检查**不能计作 D13 或判断对照节点权限通过**。档案 DTO 的字段检查也不能替代全部页面的产品不变量扫描。

## 显式实际组件回归（独立于83项schema检查）

`interview-component.verify.ts` 只消费干净固定906输入树 `c1822464f466851a37594f7ff2cf734b86711646`，其中包含900 `624e05b`、899 `d5cf82fa`、897 `0b20a913` 和896 `9533f643`。工具与输入的实际HEAD、tree、洁净检查及脚本摘要均写入输出；输入从未复制进本分支。既有83项工具保持SHA256 `607e4b8f057c319dbd1b4cd30026a8242c8e39e0ebefebb04a075370be37689f`，本片不重新执行或合算其历史83项。

```sh
node --import tsx tests/e2e/bow-871/interview-component.verify.ts --component-root "$BOW871_COMPONENT_ROOT" --maxWorkers=2
```

调用者先准备该固定HEAD的独立只读worktree及其锁定依赖；871工具树亦须已提交且干净。工具显式运行，不被默认Vitest/Playwright收集，不增加配置或通用测试框架。按共享heavy-1/2规则运行完整命令；最多接受maxWorkers=2，实际顺序调用，一次最多一个解析线程。实际906适配器等待terminate，工具另核MessagePort回到基线和活动调用归零。

| 层级                    | 真正调用与断言                                                                                                                   | 仍不能证明                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `node_worker_component` | 906真实Node线程调用900解析三套化名PDF；核固定文件字节/摘要、原量表/评级、逐字段页文本范围、页文本版本/摘要与897严格定位          | 官方模板、授权下载、原件/片段持久绑定、Next路由或部署         |
| `pure_composition`      | 把实际解析的姓名及空职位直接交906决策，缺职位保持candidate_identity_missing；非HR不给计划；899实际策略检查本人节点/跨节点/恰到期 | 生产身份与HR确认、当前SQL授权、真实事务、确认仅一次或页面流程 |

896 manifest/candidates中的预期只用于断言原始结果，不反填解析值、岗位、人员映射或授权。899公开合成关系快照只作为受控纯函数输入，实际调用授权策略，不注入allow-all。没有岗位、候选映射、确认、canonical来源或存储版本的事实就保持缺失；输入中未持久化标识不代表已归档。工具不构造一次成功入档，也不把没有写库能力当作生产数据库零写验收。

后续922 `53ad0f3`、918 `eb47234`、846 `bec28d0`、859 `f67329f`、860 `3a59c21`仍是分别固定的待接链路，本片不拼入它们。922真实读取需要PG；918/846规划、859/860端口组合不能代替发布撤销、重启、绑定ledger/恢复授权、原件和唯一producer的真实证据。下表的runtime/E2E门槛全部保留。本片结果以PR当前head实际执行为准，贡献者仍不得自审，交Claude独立审查。

## 显式 Office 组件回归

`office-component.verify.ts` 固定读取901 `dbe30d13f1ad6ae0aaaef0bf920b258805417e5d` 的真实 `parseOfficeIsolated` 与既有 `tests/fixtures/office` 字节。该901树没有包含897冻结提交，因此另用897 `0b20a913621121848219e0966ba4bf4844d1bdb3` 的独立只读树加载真实 `materialSourceLocationSchema`，不复制schema。工具和两输入的实际HEAD/tree/clean、脚本及夹具摘要均随结果输出。

```sh
node --import tsx tests/e2e/bow-871/office-component.verify.ts --component-root "$BOW871_OFFICE_ROOT" --materials-root "$BOW871_MATERIALS_ROOT" --maxWorkers=2
```

完整命令先取得heavy槽，工具与两个固定输入树须已提交且干净，并按各自根锁安装依赖。工具顺序执行，最多一个解析线程，maxWorkers只允许1或2；核调用者字节未变、实际输出摘要与格式、MessagePort回基线和活动调用归零。原83工具与interview组件脚本字节均校验不变；本片不重跑或合算其历史结果。

三份实际化名OOXML各构成一项 `node_worker_component`：PPTX按真实页序和备注关系保留四段正文/备注；两份XLSX保留公式缓存与常量、缺缓存/空文本/0/false、原表/单元格、共享公式与原始数值字串，团队合并值不扩散。预期只用于断言实际结果，没有运行生成器、反填缓存/授权或重算公式；实际输出仍为unresolved。每条实际locator交给冻结897原schema，并检查多余归属字段被严格拒绝；没有构造已持久化fragmentId或授权原件引用。

901作者已有取消/超时、恶意ZIP与预算负控证据仍归属其PR，不能算成本工具执行项目。本工具不被默认Vitest/Playwright收集，未证明应用授权/生产读取、DB事务、Next部署worker装载或浏览器E2E。本片后保留面评与Office两组组件证据，下一步应接下表仍缺的关键运行链，不继续堆同类解析指标。

## 八条合同的后续回归矩阵

下表全部仍需在集成/浏览器层接线。已有离线检查只作前置保护，不把同一份证据记成完整链路通过。

| ID  | 合同与必须观察的结果                                                                                                                          | 需接线的边界 / 依赖                                                                                   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| C1  | 原文引用必须同时带片段、原件版本、位置；点击打开真实文件/页/行/时间点；错误版本或范围外引用不给原文                                           | 873、906、908、919、923；897 `materialSourceReferenceSchema`；917 `comparisonTableRowSchema`          |
| C2  | AI 建议保存后不计入正式档案/象限；本人确认才形成一份有效分；差异达到复核门槛时进入 HR 复核                                                    | 846、849；897 `recordBatchDraftSetSchema`；建议/确认分库存储与档案实际读取                            |
| C3  | 四个预设账号从接口、计数、对象 ID、原件、上传凭证及模型输入各测；撤权旧会话失效；完整混合权限图片不能外发；范围不明时供应商调用为零           | 835、873、899、903、905、909；实际 HTTP、可信身份与供应商边界；不可用本目录的空模型输入替代零调用证据 |
| C4  | Jev 超时/失败只改变处理进度，结论为空；不能记成「资料不足」；人工判断仍为四态且署名                                                           | 852、854；实际任务执行、错误与重试读取                                                                |
| C5  | Kodo 完整归档成功后，仅离线稿可提取事件；实时预览、部分上传和失败归档不能提取                                                                 | 873、859、860；实际归档/离线转写状态与来源版本                                                        |
| C6  | 所有契约响应及实际页面不出现人才总分、排名、能力百分比、雷达；Jev confidence 不出前端；导师/评价人没有象限                                    | 837、854 与相应页面；既检查 DTO，也检查页面可见内容，不对源码中的否定说明做关键词误报                 |
| C7  | 同 operationId 同语义重放；同 key 改 payload 冲突；两个不同请求确认同一事件/维度/评价人只成功一次；旧 expectedRevision 不覆盖新结果且保留输入 | 846、899、909；真实事务、唯一约束、并发、任务 enqueue 与重新分派后的确认                              |
| C8  | 保存时锁定锚点版本，发布后再确认仍用保存版本；发布/撤销不静默重算历史；维度锚点和选拔规则按类别各取当前版                                     | 922、846、918；实际数据库保存/发布/重读                                                               |

## 决赛新增与第三轮场景

| ID  | 场景 / 必须留下的验收证据                                                                                                                                                         | 待接线与冻结入口                                                                                                                                                                                                                                                                             |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N01 | D13 同节点允许、跨节点拒绝、关系恰到期失权；仅曾参与前段不产生新授权                                                                                                              | 899、919；917 `createAuthorizedRaterComparisonSchema(access)`。`access` 只由服务端当前身份/时间/关系构造                                                                                                                                                                                     |
| N02 | HR 从页面完整重新分派；新评价人可处理、旧人失权；重复提交不重复写/发任务；旧页面不覆盖                                                                                            | 899 与重新分派前端；897 `materialReviewCommandSchema`、`materialReviewResolutionReceiptSchema`。后端调用不能冒充页面通过                                                                                                                                                                     |
| N03 | 两段原表分别打开到本人所在行；两张表可以同行号，但不能共用 originalVersionId/fragmentId；团队成员不能共用他人来源行                                                               | 919、923、873；917 `comparisonTableRowSchema`、`comparisonCaseSchema`。不能用原型快照代替真实重建表                                                                                                                                                                                          |
| N04 | 第六期保持 v1，第七期演示使用 v2；发布撤销在同事务恢复上一版生命周期、当前类别读取与新建期次默认；已绑定期次/历史不变；重启后仍成立                                               | 918、922、923；917 `selectionCohortBindingChangeSchema`、`selectionPublicationUndoBoundarySchema`、`selectionPublicationUndoReceiptSchema`、`selectionPublicationUndoTransactionSchema`、`restore_after_undo`。schema通过不等于数据库原子性/重启通过；旧发布/修订号及恰到 undoUntil 必须拒绝 |
| N05 | 判断对照原件直链、同节点/跨节点/过期；隐藏任一段时档位、引用、outcome 和推导分布一起隐藏；本人/HR分评价人统计仅由可披露案例构成；模型前再次过滤                                   | 899、919、921；917 `createAuthorizedRaterComparisonSchema`、`createAuthorizedAttributionModelInputSchema`、`createGroundedStandardHypothesisSchema`                                                                                                                                          |
| N06 | 北森面评、入营选拔、重建结营表的范围外读取被拒；未知人员/面试官进待核对并可恢复；原量表不进入正式分数、象限或找人                                                                 | 906、873、919、923；897 `materialSourceSchema`。不能把新类型强转成旧 TalentKind 来假证通过                                                                                                                                                                                                   |
| N07 | 企业微信重复回调；回执转发、切换账号、到期与旧版本深链；撤权后旧会话失效                                                                                                          | 903、909 与页面；真实 transport 回调、服务端权限与持久化                                                                                                                                                                                                                                     |
| N08 | MCP / AgentAPI 没有确认能力；伪造方法、角色与资源 ID 均不能获得确认入口                                                                                                           | 903、910、915；真实工具/动作列表及直接请求                                                                                                                                                                                                                                                   |
| N09 | 混合权限图片不外发；范围未知时模型零调用；允许子区域也必须由服务端先分类/过滤                                                                                                     | 905；896 夹具可按 SHA 只读使用，不能用图片上的权限文字当授权                                                                                                                                                                                                                                 |
| N10 | 管理观察不进匹配；节点结论独立记录且确认人正确；导出只含当前范围内已确认内容                                                                                                      | 854、902、904、912；实际匹配输入、节点结论读取、导出文件                                                                                                                                                                                                                                     |
| N11 | 845、852、854、921 固定合成样例各回归一次；输出结构、引用、允许内容一致，失败如实报告                                                                                             | 各卡已冻结样例和对应实现；不拿 mock 自己返回预设结果当模型回归                                                                                                                                                                                                                               |
| N12 | 样本不到门槛只显示样本不足；CEO 响应无按评价人的数字/准确率；AI未编辑草稿humanVersion:null，HR保存才产生人工版本；空假设成功与模型失败分开；评价人按姓名/稳定ID；判断对照不改档案 | 919、921；917 严格角色响应、归因确认与档案版本/状态前后对照                                                                                                                                                                                                                                  |

这里没有为未实现的链路编造 URL、动作名或字段。接线时先读对应卡最新公共入口，引用当时受检 SHA；已有行为与冻结约束冲突时按根因回报对应卡，不在 871 改业务或把错误行为写成期望。

## 当前917 R2输入与实际结果

本轮仅把显式工具的917冻结常量更新为 `832209d177944b5ce18577794acb88314a6460da`；897仍为 `0b20a913621121848219e0966ba4bf4844d1bdb3`。断言、合成fixture、工具逻辑与业务均未改，没有新增SHA配置接口。

在两个真实冻结HEAD、`src/contracts`无修改的独立worktree上，使用Node24.21.0 / pnpm11.25.0原样执行显式工具：**83项检查，83通过、0失败，退出0**，输出 `result: pass` / `level: frozen_schema_only`。修后的本人混HR全局、本人混隐藏计数、HR分评价人混他人统计三例均按原断言拒绝，没有把错误accepted行为改为期望。

工具文件SHA-256为 `607e4b8f057c319dbd1b4cd30026a8242c8e39e0ebefebb04a075370be37689f`；相对9543b85的工具只替换了这一SHA常量。旧80/83失败结果保留在下一节，不能作为当前输入结果，也不把本轮83项与历史29条离线回归混算。

这些结果不证明数据库事务、当前服务端授权、原件读取、发布持久化/重启或浏览器流程。显式工具中的旧P1链接保留为缺陷追踪来源，不表示本次仍失败。PR仍Draft + blocked，#63全部blocked-by与runtime矩阵未齐，不关闭871、不请求ready-to-merge。实际提交后的同输入执行证据见PR当前head记录。

## 历史：917 R1输入同步（9543b85 / da3012e）

以下为9543b85提交的历史记录：当时仅更新本目录的冻结验证工具与矩阵；897为原0b20a913，原型/契约分歧不由本工具选边；917使用da3012e，没有沿用旧2fe的43项结果。

| 已确认的917 R1输入 | 本工具的有效对照                                                                                                      | 仍需后续runtime验收                             |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 未编辑AI草稿       | HR/manager可读humanVersion:null；创建不能冒充HR版本；HR保存才有人工版本；提交须待确认且保留人工版本                   | 918/920真实人工操作、服务端签名/时间与持久化    |
| 空假设成功         | success []合法；model_failed不能带成功result；实际假设仍须引用                                                        | 921真实供应商/归因、无假设时不起草修订          |
| 配对撤销           | 新版回待确认；原previousVersion系统恢复生效；当前xe_selection读取和新期次默认恢复；已有绑定/历史不变；旧/过期操作拒绝 | 918/922同一数据库事务、失败回滚、重新读取与重启 |
| 姓名稳定顺序       | 正/反姓名顺序；同名稳定ID；重复身份拒绝；不按样本量排序                                                               | 919真实查询、授权投影和页面顺序                 |

**当时已证P1未通过**：[917精确输入缺口](https://github.com/bowenQT/QTalent/pull/258#issuecomment-6547181016)，对应自动意见discussion_r4432708827。正确5个可披露case ID不变时，本人分布混入HR全局计数、混入隐藏案例计数，以及HR分评价人分布混入他人统计，都必须拒绝。工具对这三例一律断言拒绝，当时没有把accepted行为冻结成期望。正对照先验证正确的本人/隐藏投影/HR样例，另验证错误case ID确实被拒绝。

显式工具汇总所有schema检查，任何不符输出`result: fail`、失败标签及expectedAccepted/actualAccepted，并退出1；不会用skip/todo、吞掉P1、或schema-only的其他通过项把结果改成全绿。当时等待917最后一轮修复及冻结输入更新；本轮修后结果见上面的当前段。完整blocked-by与runtime接线门禁始终保留。

9543b85在当时两个未修改冻结worktree上的实际输出：83项schema检查，80项通过、3项失败；失败恰为上面三例分布混入，均expectedAccepted:false / actualAccepted:true，进程退出1。29条既有main公共边界离线回归另行通过，不与这83项混算、不代表P1已修复。完整runtime验收仍按八条合同/十二类矩阵待接线。

## 执行与收集边界

需要 Node 24 与项目锁定依赖。当前 main 检查：

```sh
pnpm exec vitest run tests/e2e/bow-871 --maxWorkers=2
pnpm exec prettier --check tests/e2e/bow-871
pnpm exec eslint tests/e2e/bow-871
pnpm exec tsc --noEmit
```

现有 Vitest 会收集 `tests/e2e/**/*.test.ts`，Playwright 收集 `tests/e2e/**/*.spec.ts`。本轮不创建 `.spec.ts`，因为新业务页面尚未接线。不要把需要数据库的 `.integration.test.ts` 放在本目录：当前默认单测的 exclude 只排除 `src/**/*.integration.test.ts`，会把这里的数据库测试误纳单测。确需独立数据库回归收集时登记共享配置请求交 X1，不修改配置。

冻结契约的隔离检查显式运行，不进入默认测试计数。准备两个临时 detached worktree，源文件保持冻结 SHA 未修改，且让它们使用已经安装的同版本依赖：

```sh
git worktree add --detach /tmp/bow-871-materials 0b20a913621121848219e0966ba4bf4844d1bdb3
git worktree add --detach /tmp/bow-871-iteration 832209d177944b5ce18577794acb88314a6460da
ln -s "$PWD/node_modules" /tmp/bow-871-materials/node_modules
ln -s "$PWD/node_modules" /tmp/bow-871-iteration/node_modules
node --import tsx tests/e2e/bow-871/frozen-contracts.verify.ts --materials-root /tmp/bow-871-materials --iteration-root /tmp/bow-871-iteration
rm /tmp/bow-871-materials/node_modules /tmp/bow-871-iteration/node_modules
git worktree remove /tmp/bow-871-materials
git worktree remove /tmp/bow-871-iteration
```

工具核对 worktree HEAD 和 `src/contracts` 没有修改后，直接加载真实 schema 与原有合成 fixture；没有在本分支复制契约源码。输出明确标 `frozen_schema_only`，不证明当前服务端授权、原件可打开、发布事务、重启或浏览器流程。默认 CI 不执行这个显式工具；冻结提交合入 main 后才把相应用例接入常规回归。

完整 check / integration / e2e / visual 仍按主仓 heavy-1/2 槽运行；单测限制两 worker。调用真实服务是后续显式验收，本目录无需凭证，也不加载供应商环境。
