# 入营选拔标准生命周期（BOW-918）

输入契约为 BOW-917 冻结 `832209d177944b5ce18577794acb88314a6460da`；917 已由 Claude 编排合入 main `5726fd5d0cd6457d762327829adc002b1dda41b3`。当前通过 X1 组合 `04b5e9ad486feff0e3be3ced8925a82fc36c3e2e` 消费已合入的922类别/按时读取及区段切换、919 canonical `7770b97` 与921原生归因/提案 `fbaaf884`；组合不代表这些后继PR已合入main。

## 当前边界

`selection-standard.ts` 提供无数据库副作用的领域计划，`server/usecases/selection-standard.ts` 编排可信账号、当前服务端权限、领域计划、审计和操作回执。`selection/postgres.ts` 新增六表的原生事务适配，复用 922 类别锁、按时读取和区段切换。公共出口与最终迁移仍只由 X1 修改。

适配要求调用方提供同一原生事务内的 `loadAuthority`、`creationFacts`、`verifyBasisDisclosure`、`readImpact`、`readCohort`；缺一个就拒绝构造，没有管理员或内存事实兜底。`verifyBasisDisclosure` 要逐条返回已核对的引用（期次与段别），适配在 HR 用途的 `readRevision` 和 HR 回执的 `readOperation` 返回私有依据前调用它；返回值缺失或形状不对按装配故障失败关闭，引用与依据不一致按无权限拒绝。管理者用途的 `readRevision` 只供发布和退回在内部规划，对外只返回管理者投影或回执。`createNativeSelectionLifecycle` 已用同事务的真实目录授权、919 canonical、921已确认归因/提案及922/918标准绑定装配这些端口，详见下节。Web action/query 尚未接线；显式基线导入及最小期次创建/绑定/读取仍在同一 native 用例文件。原postgres协议测试的合成端口与新增真实装配测试分别记录，不相互冒充。

最终迁移在846 → 845 → 873主链之后按X1游标生成；当前不提交 SQL、journal 或 snapshot。917/922已合入；919/921实际代码依赖与正式迁移未齐，默认CI仍不能通过，本卡保持Draft+blocked。补齐必要门禁后转Ready for review，处理当前head审查与connector，不把Draft交接当整卡完成。

## 身份、范围与返回数据

- 入口从可信 session 取得 accountId。用例在事务取得类别与操作键锁后取业务时钟，重新加载当前服务端授权。原生适配核账号、人员、非系统管理员业务身份及当前时间；颁发的身份对象不可变，不能在同一事务中换账号或用复制对象替代。
- HR 编辑、提交、撤回；管理者确认、带理由退回和撤销。归因必须由服务器解析到批次与期次，再核当前权限，不能借旧署名、客户端角色或账号名字授权。
- HR 动作及幂等重放检查响应涉及的每个期次；局部撤权后不能返回旧预览。没有可信下一期授权事实就关闭该路径，不从 UI 推断。
- 管理者投影只含保存的人工稿、同一份影响预览与批次聚合摘要，去掉 HR 私有归因、AI 原稿和案例引用。完整绑定快照仅用于管理者撤销事务。
- 原生事务对象由各 store 私有状态登记，拒绝伪造、跨 store、复制、过期及只读上下文写入。意外数据库错误仅暴露稳定 unavailable 与 SQLSTATE，不携带 SQL、参数或原始异常内容。

## 六表与基线

| 表                                     | 保存的事实                                                                              |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| `evaluation_selection_revisions`       | 草稿/待确认/生效/替代修订、保存的影响预览及完整领域快照；草稿预留版本号不冒充已发布目录 |
| `evaluation_selection_version_content` | 基线或已发布的不可变标准内容、明确来源和记录时间                                        |
| `evaluation_selection_publications`    | 发布/撤销回执、上一侧快照及替代修订号、前后区段身份与 generation                        |
| `evaluation_selection_category_heads`  | xe_selection 当前版本/区段/修订/发布身份、单调 generation 与版本分配序号                |
| `evaluation_selection_cohort_bindings` | 稳定 cohortId 的一次性采用版本与绑定时间                                                |
| `evaluation_selection_operations`      | actor/operation 唯一请求、规范化载荷指纹、可见期次集合与成功回执                        |

`initializeSelectionBaseline` 是显式的已审来源导入入口，不在启动时隐式执行。调用方必须提供真实基线内容、来源、已存在的 xe_selection 目录及有效区段、版本分配起点；适配验证它们相符，不从版本名猜文本，不伪造 HR 人工发布。测试用自建合成基线，不是生产种子。

## 生命周期与原子事务

创建是 `draft + humanVersion:null`。HR 实际保存后才形成署名人工稿，保存 contentRevision 与影响预览。提交和发布核 expectedRevision、expectedPreviewId；确认人看到保存的快照，事实漂移则 conflict，不在确认时静默刷新统计。

所有写事务使用 Read Committed，依次取得 922 的 xe_selection 类别 advisory 锁、账号/操作键锁、类别 head 与当前修订行锁，再执行用例回调取业务时间和当前权限。发布、撤销及新建期次采用必须共享此类别锁。类别 head 以完整版本/区段/发布/修订身份及 generation 做 CAS，两侧修订也校验并递增。

一次发布原子写入不可变内容与目录、旧侧 active → superseded、新侧 pending_confirmation → active、922 区段切换、发布回执、类别 head、审计和幂等结果。迟发的审计、ledger 或 CAS 错误必须回滚整个原生事务。已发布内容即使撤销也不能原位编辑；重新发布同一不可变版本只新增生效区段与发布回执，不改原内容或来源。

撤销限定 `[publishedAt, publishedAt + 5000ms)`，同时核当前发布 ID、修订、generation、版本及区段。新侧回待确认，旧侧从保存的 active 快照恢复，但修订号从其当前 superseded 修订继续递增；不回拨旧修订号。恢复后的 head 清空 currentPublicationId、增加 generation，旧回执不能覆盖后续操作。基线本来没有修订实体时保留明确空值，不造一条人工修订。

922 保存每次生效的独立区段：v1 `[t0,t1)`、v2 `[t1,t2)`、恢复 v1 的新段 `[t2,∞)`。不伸展旧 v1 区段抹去历史。同毫秒的空段保留操作留痕但不作为有效版本返回；反向、未来、重叠、旧 period 冲突保留真实失败语义。全局只读门面若不含 conflict，须在接线前协调，不能伪装 not_found。

同账号操作键重放先重新核当前可见范围，再返回 ledger。带 HR 私有依据的结果（create/save/submit/withdraw），无论新操作还是重放，返回前都按当前节点关系重核每条归因引用，撤权后返回 forbidden；相同键异语义 conflict，不重复写状态或审计。事务结束前核持久计划、审计及 ledger 已配套，未完成协议则回滚。固定账号操作键与类别锁使用 PostgreSQL 既有事务 advisory 锁，没有新扩展或服务。

## 期次绑定

`bindCohort` 必须在该 store 的 `ports.transact` 内调用：先取得上述类别锁，再由可信服务在同一原生事务创建/读取实际期次和当前身份，按当前生效区段插入一次绑定及审计。重复采用返回已保存绑定，不修改版本。`createSelectionCohort` 已将实际目录期次创建和首次采用放在同一原生事务，使用同一个绑定计划/当前922读取，不另造发布器；Web入口仍需独立接线。

第六期留 v1；发布后已绑定 v2 的第七期在撤销后仍留 v2；之后新建期次恢复默认 v1。按期次查询先核当前该期次范围授权，仅读保存的绑定和不可变内容；没有绑定返回 not_found，不拿全局当前版补历史。发布/撤销不会写历史结果、分数、冻结快照或档案版本。

## 验证与剩余验收

领域与用例单测覆盖角色与局部撤权、人工编辑、原文核验、预览漂移、五秒窗口、旧撤销与绑定保留。原生适配的离线测试只证明上下文所有权、可信身份和安全错误边界；假 DB 边界明确不执行 SQL，不能证明数据库事务效果。

`selection/postgres.integration.test.ts` 使用唯一随机 loopback `_test` 数据库、固定化名导入和显式合成基线，覆盖并发发布/幂等、真实授权在类别锁等待后撤销、迟发回滚、同毫秒区段、配对修订与旧回执、不可变重发、期次持久绑定及既有资料指纹。归因与影响端口仍使用合成来源。表结构来自正式迁移 0011，测试固定使用 `src/server/db/migrations`，原临时迁移目录变量已退役。

原生生命周期和新装配测试使用空的真实迁移数据库及独立显式合成事实。新装配通过真实919 writer与921 store生成持久输入，不用expected回填918生产端口。测试只通过 `test-db.env` 注入测试库，固定参照需先运行 `pnpm reference:prepare`；迁移只用正式目录。具体受检SHA、命令与覆盖结果以PR证据为准。

## 显式基线与实际期次装配

- `initializeReviewedSelectionBaseline(db, accountId, reviewed, clock)`：当前真实管理者授权后，在同一事务导入 `demo_import_snapshot` 目录、实际922开放区段、不可变基线内容、918 head与审计。`reviewed` 必须明确包含 `versionId/content/sourceCommit/sourceReference/effectiveFrom/periodId/nextVersionOrdinal`。无默认生效时间、无伪造publisher；这不是接受客户端角色/任意基线的Web动作。
- 同基线并发重复调用不重写事实、不重复审计；不同内容/来源/区段拒绝。审计失败整体回滚。现有发布目录不可被重标为导入快照，已关闭区段不可被重开。
- `bindExistingSelectionCohort(db, accountId, cohortId, clock)`：真实当前manager或该期HR，核实际cohort存在后，仅在generation1、无发布修订的显式基线初始化阶段一次性采用基线。发布或撤销后不得给旧期次补绑当前版本。它不创建目录期次、不接受指定版本，也不伪造历史绑定时间。
- `createSelectionCohort(db, accountId, {id,name}, clock)`：当前manager在同一事务创建实际cohort并首次绑定。缺基线/审计失败整体回滚；相同id不同名称拒绝；已有但未绑定期次也拒绝，不能借创建入口补写历史。仅最小创建/绑定能力，不实现完整选拔流程。
- `readNativeSelectionCohortVersion(db, accountId, cohortId, clock)`：当前实际身份/期次范围授权后读已保存绑定及校验不可变内容，缺绑定返回null，不用当前默认补历史。原有store也复用同一绑定primitive。
- `loadSelectionAuthority` 针对这些读写事务锁定真实账号绑定/授权/人员，再取业务clock；不能直接当作原store只读事务的FOR SHARE回调。完整store装配必须明确只读/写事务边界。

真实923的基线 `effectiveFrom` 和历史期次采用事实尚未获批准；本实现与合成测试不会替它选择日期。923不得以本测试输入初始化实际演示基线。919/921生产事实读取和AI提案采用已在固定组合实测；下一期真实描述仍须经审查的服务器配置，不给默认值。

剩余门禁：Web action/query的可信session入口、919/921代码依赖与X1正式迁移、默认当前head完整检查与审查。真实基线时间/下一期描述仅阻真实环境应用，不能用合成测试值补生产配置。871场景联验另记证据；本卡真实PG不是浏览器或生产E2E。

给921的服务器内部真实标准入口：`selection/postgres.ts` 的 `readCurrentSelectionStandard(tx, requestedVersionId, clock)`。消费实际922当前类别/时点版本并核918 head/不可变内容；无生效版本或请求的版本不是当前版返回null，损坏/冲突失败。它不授权Web或模型披露，921仍先执行当前HR/节点授权；不支持把历史版本当当前基准。公共出口仍由X1补。

## 真实归因、影响与AI采用装配

`createNativeSelectionLifecycle(db, {nextCohort, clock})` 返回原store和`execute`、`adoptProposal`。账号只可来自服务器认证入口；`nextCohort` 是经过核实的未来期次稳定ID/名称/来源描述，构造时冻结，缺失即unavailable，已存在的cohort不能冒充未来期次。此配置不从浏览器命令或期次排序推导，不创建空的未来cohort。

- `selection-standard-facts.ts` 先读取归因/批次的路由元数据、核当前HR范围，再读真实签名归因；行锁保留归因/提案直到事务提交。每个引用重核当前两节点权限与真实source版本、位置和全文，历史署名不产生当前权限。归因修订或基准版变化即冲突。
- 管理者摘要仅在服务器内把真实canonical送现有919算法，计偏差人数并保留归因类别；不向管理者返回人名、原文、评价人数字，不另建页面loadBatch或复制算法。
- 影响预览读取真实已绑定期次和canonical前段判断。按人、前段节点、判断稳定ID去重；缺前段不计；按该期次 HR 的当前来源规则计数（人员在该期次有当前在营记录、非不参与评价、属于前段节点），与调用者身份无关，所以 HR 保存的预览与管理者发布时的重算口径一致。保存的scope在刷新/发布时保持，管理者不会扩大成全库范围。持有comparison批次表SHARE锁和既有逐行读取锁，防止确认预览与发布之间新导入批次改变计数。最终仍使用原918发布事务及922区段切换。
- `adoptProposal` 只读取921已保存且归因/基准版完全匹配的提案，新建draft时保留AI原稿，humanVersion仍null。真实HR save才产生hr_edited。重放返回原回执，迟到提案没有修改既有人工作品的入口；相同操作号不同提案使用不同内部操作键，不混淆幂等事实。
- `selection-standard-facts.integration.test.ts` 实跑真实初始化→绑定→canonical持久化→921确认/提案持久化→918采用→HR修改→提交→管理者发布，以及撤权、引用漂移、旧归因/标准、去重、预览变化和只读查询。唯一模型为明确离线替身；上游921仍注入显式化名ComparisonDataset，仅证明实际921存储/权限和918读端，不证明尚未交接的共享canonical到921页面DTO转换。没有供应商调用。

统一覆盖范围为selection领域、postgres、selection-standard用例、native与facts五个执行文件；具体命令、受检SHA、项目数及行/分支值以PR当前证据为准，不套用旧版108项结果。
