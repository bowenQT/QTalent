# 评价节点、关系与重新分派（BOW-899）

基于 BOW-897 冻结提交 `0b20a913621121848219e0966ba4bf4844d1bdb3`。这是本卡实现的消费说明；programs 公共出口已由 X1 接入，档案读取适配与最终迁移仍待协调，不能把核心验证通过当作整条读取链路完成。

## 节点与权限

- 节点类型为 `program_cohort / interview / defense`。人才项目期次一对一映射节点，团队项目继续使用 staffing 的期次。事件直接保存 `evaluationNodeId`，与 `projectId` 是否存在独立。
- `evaluationNodeSubjects` 记录节点涉及的被评价人；`evaluationRelations` 明确评价人、被评价人、节点、关系标签和有效期。旧 assignments 不在新授权函数中充当节点授权。
- 有效期为左闭右开，撤权在 `revokedAt` 时生效；应用入口使用业务时钟的 ISO instant，不能用页面缓存或仅日期截断替代。
- 评价人只在当前有效的精确节点关系内读取人员、评价和已确认维度分；象限、管理观察、绩效不随评价关系开放。管理者和 HR 保持既有范围。系统管理员、未知或不参与评价的主体拒绝。
- `canConfirmOwnNodeScore` 要求有效关系且 raterId 为当前人；关系标签 judge 不授予替别人确认评分或确认节点结论的权限。节点结论的 HR 确认仍由 BOW-902 实现。

## 读取与模型输入接线

`authz/talent.ts` 支持带完整节点事实的上下文；一旦提供任意一种节点事实，缺少其余事实就拒绝。完整上下文中，评价人的节点证据必须有服务端解析的 evaluationNodeId；不能回退到同人旧导师分配。人员目录身份可通过仍有效的节点关系显示，不能据此带出别的节点证据。

X1 必须把三个数组都接入共享上下文：`evaluationNodes`、`evaluationNodeSubjects`、`evaluationRelations`。档案的 eventSubject、来源的每个 subject 和字段的来源主体要保留内容所属节点；混合片段逐一校验，在交模型前过滤。P0 上下文兼容分支仅用于尚未切换的读取；在所有读取适配和回归完成前，本卡不能标完成或合入。

`person-data.ts`、`person-projection.ts` 及相关测试/夹具目前与 #252 / #202 重叠，由 X1 协调 writer。BOW-838 的 workbench 查询不在本会话写入范围。

## 待完成事项与 D13

`evaluationWorkItems` 是待确认、待核对事项的分派归属。resourceId 指源模块的确认任务或待核对条目 ID，不是整个人或整个事件；同一来源任务重放保持稳定事项 ID。关系到期后，pending/processing 事项进入范围内 HR 的重新分派列表。候选仅为同节点、同主体的当前有效关系，关联目录已有人员；未知面试官还须同时满足接手人的当前 HR 范围，不能只凭关系标签。

- `insertEvaluationWorkItem(tx, input, now)`：源用例先做创建授权，再在自己的事务中登记；业务键重复时返回当前记录，不重置改派结果、状态或 revision。
- `canWorkOnEvaluationItem(context, item)`：源动作和 worker 写入前核对当前账号、绑定关系、节点及状态，不能仅凭页面中的人员 ID。
- `completeEvaluationWorkItem(tx, workItemId, expectedRevision, loadCurrentContext)`：源业务保存与事项完成在同一事务提交；回调在取得事项行锁后重载权限与业务时钟，源事务使用 Read Committed 加事项锁/版本栅栏，旧 worker / 原评价人的失效版本不能提交。
- `reassignEvaluationWork`：服务端解析当前账号；Read Committed 事务中取得操作键锁和事项行锁后重载当前已提交授权，校验旧 revision、过期归属和接手关系。改派、操作回执和审计同事务提交。
- 同账号、同 operationId、同语义内容重放原回执；完成或再次改派不阻止旧成功请求重放，但每次重放仍检查当前 HR 权限。同键异载荷、旧版本和失效候选明确返回 conflict。

BOW-846、860、905、906 的源动作/任务需要按各自范围接入登记、归属检查与完成端口；此文件不宣称这些下游已经接入。

## 旧数据迁移计划

`planLegacyEvaluationNodes` 只生成可审阅数据计划，不执行数据库写入。节点 ID 为 `cohort:<旧期次ID>`，关系 ID 为 `assignment:<旧分配ID>`，保留原有效期与撤权，不重算评分和快照。

明确 project cohort 的事件只绑定到该期次；无项目事件按发生日的既有成员/分配事实，仅在候选期次唯一时生成绑定计划。缺失项目、项目无期次、未知主体或多候选都显式列入 unresolved。不得用当前人员期次替代历史出处，或把未知当成低潜力。

现有事件的节点列允许旧未映射行保留 null；切换后的评价人读取对它们关闭，管理者/HR 的既有范围保持。新批次草稿使用 897 的必填节点。X1 应核对 unresolved 清单、先生成最终 schema 迁移，再在事务中应用映射；已发布迁移不重写。迁移队列本卡排第一位。

## 验证边界

纯节点策略、来源过滤、改派策略、映射计划与服务端入口分别有行为测试；真实 PostgreSQL 测试覆盖改派并发、幂等回执、审计回滚、等待锁期间的权限撤销和旧处理人的完成拒绝。测试从当前 Drizzle 定义生成临时隔离库结构，不代替最终迁移验证。完整档案/工作台回归及最终迁移仍须在接线后实跑；本卡的 PR 记录实际受检 SHA、命令和结果。没有 TEST_DATABASE_URL 时不得跳过真实 PostgreSQL 测试或使用空集冒充通过。
