# 评价节点、关系与重新分派（BOW-899）

原实现基于 BOW-897 冻结提交 `0b20a913621121848219e0966ba4bf4844d1bdb3`；本次消费最终冻结 `e4462114690191fb9cbcd403f6fb0090bd3cfddb`，已经随 #254 合入 main `42056e02226f4c53a0b595d549dd329c158b70c4`；旧 ac 候选不再作为当前输入。这是本卡实现的消费说明；programs 公共出口已由 X1 接入，本次 X1 将档案、列表/速览、来源和模型输入接到同一份当前节点事实，正式迁移随本卡交付；下游各源流程仍按各自卡接入。

## 节点与权限

- 节点类型为 `program_cohort / interview / defense`。人才项目期次一对一映射节点，团队项目继续使用 staffing 的期次。事件直接保存 `evaluationNodeId`，与 `projectId` 是否存在独立。
- `evaluationNodeSubjects` 记录节点涉及的被评价人；`evaluationRelations` 明确评价人、被评价人、节点、关系标签和有效期。旧 assignments 不在新授权函数中充当节点授权。
- 有效期为左闭右开，撤权在 `revokedAt` 时生效；应用入口使用业务时钟的 ISO instant，不能用页面缓存或仅日期截断替代。
- 评价人只在当前有效的精确节点关系内读取人员、评价和已确认维度分；象限、管理观察、绩效不随评价关系开放。管理者和 HR 保持既有范围。系统管理员、未知或不参与评价的主体拒绝。
- `canConfirmOwnNodeScore` 要求有效关系且 raterId 为当前人；关系标签 judge 不授予替别人确认评分或确认节点结论的权限。节点结论的 HR 确认仍由 BOW-902 实现。

## 读取与模型输入接线

`authz/talent.ts` 支持带完整节点事实的上下文；一旦提供任意一种节点事实，缺少其余事实就拒绝。完整上下文中，评价人的节点证据必须有服务端解析的 evaluationNodeId；不能回退到同人旧导师分配。人员目录身份可通过仍有效的节点关系显示，不能据此带出别的节点证据。

`loadPersonData` 在只读 Repeatable Read 事务中复用 `loadEvaluationContext`，同时加载三个数组：`evaluationNodes`、`evaluationNodeSubjects`、`evaluationRelations`。档案的 eventSubject、来源的每个 subject 和字段的来源主体要保留内容所属节点；混合片段逐一校验，在交模型前过滤。生产档案、目录/速览与来源入口统一使用这个 loader 和完整 ISO 业务时钟。授权库保留无节点上下文的旧纯函数兼容分支，未用于这些生产读取；部分节点上下文仍拒绝，不能据此恢复旧带教范围。公共 DTO 的日期字段单独取业务日。

历史评价增加可空的 `evaluationNodeId`，原量表、署名和来源保持不变。已知周评仅继承同一来源事件的明确节点；独立结营/面评没有节点事实时保持 null。`restricted-evaluation` 只对确有当前精确节点关系的评价人开放；旧期次带教不授权，管理观察、绩效和象限仍关闭。BOW-838 的新 workbench 查询属于其独立卡；本卡以已存在工作台和人员读取回归验证兼容性。

## 待完成事项与 D13

`evaluationWorkItems` 是待确认、待核对事项的分派归属。resourceId 指源模块的确认任务或待核对条目 ID，不是整个人或整个事件；同一来源任务重放保持稳定事项 ID。关系到期后，pending/processing 事项进入范围内 HR 的重新分派列表。未知面试官、未知面评候选人还要求处理人具有当前范围内 HR 资格；即使其节点关系仍有效，失去该资格后也进入同一分派列表。队列与提交共同使用 assignedEvaluationHandlerIsCurrent/既有候选策略，原处理人仍合格时拒绝转交，操作锁后重载事实避免撤权/恢复竞态。候选仅为同节点、同主体的当前有效关系，关联目录已有人员；事项类型为 `confirmation` 及六类待核对：`speaker / unknown_person / image_scope / unknown_interviewer / unknown_project / unknown_interview_candidate`。两类面评核对（未知面试官、待认面评候选人）还须同时满足接手人的当前 HR 范围，候选读取、改派和完成各自检查；历史面评署名、关系标签都不授予当前权限。

- `insertEvaluationWorkItem(tx, input, now)`：源用例先做创建授权、解析可信的节点/主体/原归属关系，再在自己的事务中登记；本域严格校验非空稳定来源 ID 与登记字段，数据库再约束节点、主体及归属关系的一致性；业务键重复时返回当前记录，不重置改派结果、状态或 revision。
- `canWorkOnEvaluationItem(context, item)`：源动作和 worker 写入前核对当前账号、绑定关系、节点及状态，不能仅凭页面中的人员 ID。
- `completeEvaluationWorkItem(tx, workItemId, expectedRevision, loadCurrentContext)`：源业务保存与事项完成在同一事务提交；回调在取得事项行锁后重载权限与业务时钟，源事务使用 Read Committed 加事项锁/版本栅栏，旧 worker / 原评价人的失效版本不能提交。
- `reassignEvaluationWork`：服务端解析当前账号；Read Committed 事务中取得操作键锁和事项行锁后重载当前已提交授权，校验旧 revision、过期归属和接手关系。改派、操作回执和审计同事务提交。
- 同账号、同 operationId、同语义内容重放原改派回执；完成或再次改派不阻止旧成功请求重放，但每次重放仍检查当前 HR 权限。同键异载荷、旧版本和失效候选明确返回 conflict。

BOW-846、860、905、906 的源动作/任务需要按各自范围接入登记、归属检查与完成端口；此文件不宣称这些下游已经接入。源业务的幂等成功回执应先于再次完成事项的状态检查重放；`completeEvaluationWorkItem` 对完成/取消事项拒绝写入，本身不是源业务成功回执表。

`unknown_interview_candidate` 的待核对契约尚未确定人员身份，而现有原生事项表要求已知 `personId`，并外键绑定同一节点、主体和评价关系。因此这里只接收源服务已经可信解析主体的事项：缺少锚点时不登记，不能拿候选姓名、历史署名、默认人员或默认关系补齐。完全未知面评候选人的源登记仍需 BOW-906 与 X1 明确可信锚点，类型已支持不代表该源流程已接通。`resourceId` 必须是确切的待核对 `itemId` 或确认任务 ID，不能用材料批次、人员或事件 ID 替代；同人同类型的不同事项独立保留，完成/取消项按实际持久状态退出队列，重复登记不复活。

897 的 resolvedItems、observedName/quote 和 hasHiddenContent 是源用例在当前权限过滤后构造的只读回执字段，不进入本域登记或授予权限。重新分派读取实际原生事项状态，仅 pending/processing 可分派；resolved 不是第八种事项类型，undo 也不是一种评价关系或授权。

源核对撤销后，源用例须在自己的真实事务中同步当前事项状态与修订；重复调用 insertEvaluationWorkItem 不会把 completed/cancelled 复活。现有源端口尚未接通的地方保持缺口，不把只读回执、hasHiddenContent=false、历史人名或“可撤销”标志当作可信锚点。本卡不新增伪实现的核对撤销/结果历史存储；实际消费者需要时再按具体源事实接线。确认撤销沿用846现有五秒服务器墙钟窗口，超时只读，更正赛后；不借分派延长窗口。未新增评价节点类型。

## 旧数据迁移计划

`planLegacyEvaluationNodes` 只生成可审阅数据计划，不执行数据库写入。节点 ID 为 `cohort:<旧期次ID>`，关系 ID 为 `assignment:<旧分配ID>`，保留原有效期与撤权，不重算评分和快照。0004切换后，评价授权以 evaluation_relations 为准；收回带教须撤销对应新关系（也可同时撤销旧 assignments），仅改旧表不会撤销新节点权限。旧表保留历史/种子来源，不作为运行时双向自动同步入口。

明确 project cohort 的事件只绑定到该期次；无项目事件按发生日的既有成员/分配事实，仅在候选期次唯一时生成绑定计划。缺失项目、项目无期次、未知主体或多候选都显式列入 unresolved。不得用当前人员期次替代历史出处，或把未知当成低潜力。

现有事件的节点列允许旧未映射行保留 null；切换后的评价人读取对它们关闭，管理者/HR 的既有范围保持。新批次草稿使用 897 的必填节点。本卡正式结构为 Drizzle 原生生成的 `0003_bow_899_evaluation_nodes.sql`；独立的 `0004_bow_899_legacy_node_backfill.sql` 使用 Drizzle `--custom` 入口维护一次性数据转换，没有手改生成 DDL。旧 0000–0002 SQL 和对应 snapshot 不变。默认 migrator 在同一事务中应用结构、数据和 journal，失败全部回滚；没有测试专用覆盖目录。迁移队列本卡排第一位，922 必须等本卡实际合入 main 后再生成。

数据迁移对旧成员/带教事实加事务锁，保留原有效期与撤权；日期到 instant 明确按 UTC，与旧业务日语义一致。只有来源明确为固定 2e51b50 快照、同人同日同事件 `.sum` 的周评才继承事件节点，其余历史不按当前期次猜测。新库的显式 demo seed 使用同一映射计划；重复 seed 不重置节点关系的撤权/有效期，也不恢复人工已移除的证据绑定。

发布先备份并保留前一应用版本与对应数据库快照，再显式运行迁移。失败可直接保留原版本（DDL/回填/journal 同事务回滚）；成功后不提供删除节点事实的自动 down migration。若需要回退，必须按受审发布步骤恢复同一备份点的应用与数据库，不能仅退旧应用让旧 assignments 越过新节点撤权，也不能在已有新节点写入后丢弃新事实。普通启动、构建不迁移数据库。

## 验证边界

纯节点策略、来源过滤、改派策略、映射计划与服务端入口分别有行为测试；真实 PostgreSQL 测试覆盖六类核对事项的候选读取、改派并发、稳定事项引用、完成/取消后重放、审计回滚、等待锁期间关系或 HR 权限的撤销和旧处理人的完成拒绝。这些真实 PG 测试和新增读取回归均运行默认正式迁移。升级测试先仅运行已发布 0000–0002、写入已验证原型全量事实，再运行本卡迁移，逐表核对旧分数/量表/来源的指纹不变；另测空库外键、重叠或缺失归属拒绝、回填失败时结构与 journal 一并回滚，以及重复迁移/seed 不复活撤权或解绑。完整检查与实际受检 SHA、计数以 PR 回执为准，不把局部测试当下游正式链路完成。没有 TEST_DATABASE_URL 时不得跳过真实 PostgreSQL 测试或使用空集冒充通过。
