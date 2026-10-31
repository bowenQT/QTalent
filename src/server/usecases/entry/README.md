# BOW-903 多入口核心（提前实现）

本目录提供框架无关的可信身份、当前权限加载、工具调度和普通深链校验。它尚未接入生产 Web、企业微信、MCP 或 AgentAPI；默认缺少映射、令牌查验、领域 handler 或版本读取器时拒绝执行。端口组合单测不代表生产跨入口结果等价。

## 固定输入与边界

- 新分支从 main `dc53fbe54179281b5bee37877aba7795eea3a4d1` 建立，显式合入 BOW-899 `96fa3aa8e9858c76db2125ac5ab79764f45d45ab`（包含 BOW-897 冻结 `0b20a913621121848219e0966ba4bf4844d1bdb3`）。不复制节点或材料合同。
- 当前授权读取复用 `loadProjectContext` 和 programs 公共出口的 `readEvaluationAuthorizationFacts`。三个节点事实数组必须齐备，不回退至旧的期次权限，也不让管理员服务身份兜底。
- 只增加本卡的 entry 合同和独立目录；不修改 person 查询/夹具、899 节点核心、业务持久表、迁移、公共出口、worker、边界脚本或依赖。
- 897 状态、动作和模型外发口径仍待裁决，本卡沿用固定输入验证形状，不决定这些争议。生产材料外发 handler 保持未接线。

## 可信身份

`createEntryIdentityService` 只产生进程内的不可复制身份引用，不签发个人令牌。入口的服务端 verifier 必须验证实际 Web 会话、企业微信账号映射、MCP 个人令牌或 AgentAPI 会话与账号的绑定，再返回 `credentialId/accountId/revision/expiresAt/revokedAt`。不得把请求中的账号、角色或用户 ID 当作验证结果。

每次调用均向最初发行渠道的 reader 回查当前绑定；撤销、删除、换账号、revision 变化和到期会使旧身份失效。相同 credentialId 在其他渠道不能续活旧身份，凭据续期不能延长已发身份的原截止时间。安全时钟独立于领域测试时钟。身份不序列化原凭证、账号或角色；不提供默认生产 verifier。

`createEntryContextLoader` 重新加载当前完整事实，校验账号与可信身份一致并排除系统管理员身份；业务时钟由服务端提供。`loadEntryAuthorizationContext` 是已有公共读取的可选组合函数，未自行访问私有领域表。

## 工具清单与权限

| 入口           | 工具                                                                                                                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP            | `record_moment`、`person_brief`、`draft_requirement`                                                                                                                                                 |
| 企业微信       | `record_moment` / `submit_material_batch`、`read_material_batch`（材料提交与回执）                                                                                                                   |
| AgentAPI       | `submit_material_batch`、`read_material_batch`、`person_brief`、`draft_requirement`、`read_requirement_status`、`read_match_results`、`read_comparison_summary`、`read_revision_status`、`web_entry` |
| Web 的应用调用 | 同一固定白名单；人工确认等操作另走人操作接口                                                                                                                                                         |

`ENTRY_TOOL_PERMISSIONS` 给出各工具的语义权限。它不是角色授权表；每个领域 handler 必须使用当前服务端事实核验相应的材料批次、人员、项目、候选证据或汇总范围。确认评分、确认需求、归因、发布、重分配等名称和参数不在本工具面。

成功 payload 复用冻结的材料回执、QuickView、需求任务快照和匹配四态。需求状态只返回 id/revision/status。工具错误只返回固定 status，不能透传 ActionResult 的 input、原始 fieldErrors、供应商异常或业务私有 message。第三幕两个读取名称已定义，但本输入没有它们的冻结输出 DTO；即使误装 handler 也返回 unavailable，不提供 unknown JSON 成功槽。

工具 handler 必须同时提供 `authorize`、`execute`、`authorizeOutput`：

1. 验证可信身份和当前权限后才执行领域操作。
2. `execute` 返回成功 payload，不返回完整 ActionResult；只允许当前事务内的领域写入或入队，不在事务中调用不可回滚的模型、供应商或外部通知。
3. 执行后重新回查身份和当前权限，再验证成功 DTO、已授权输入与实际输出对象/版本的一致性，最后核验实际输出涉及的全部对象和来源。
4. 审计只记录账号、渠道、固定工具名、对象标识和版本；不得记录原材料、请求参数、凭证或模型原始响应。写入与成功审计同事务。

`authorizeOutput` 不能只重复校验最初输入。例如：任务结果为 null 时，仍须从事务内的任务归属确认 job 对应已授权项目；QuickView 的人员、角色、每个来源及来源性质均须按当前权限重新投影，不能因 strict schema 合法就放行绩效或晋升隐私；匹配候选人不能借需求权限获取其未授权证据。不存在这些适配器时保持 unavailable。

事务端口必须在回调抛错时真正回滚，不能把拒绝结果当正常返回提交。Read Committed 下，领域 handler 先锁定相关当前行，再调用传入的 `loadCurrent` 并重验权限和版本；凭据/授权关系的并发变更需要实际适配器的锁与事务约定。此实现检查中途撤权，但未宣称已验证 PG 并发或跨进程撤权线性化。

## 普通深链

保留路径 `/entry/open?kind=...&id=...&expectedRevision=...`，仅支持实际具有 revision 的 `material_batch` 和 `staffing_demand`。当前人员合同没有 revision，不能编造人员版本。该路径尚无 Next 页面或 API 接线，返回 ready 仅表示用例检查通过。

链接没有授权能力；URL 只带对象定位和期望版本，不含原文、分数或凭证。转发者和换账号者必须重新认证并按当前权限查询。当前版本只在授权后比较，旧版本返回刷新链接；无权限者不能借旧链接得知新版本。登录回跳只接受本目录生成的规范相对 URL，拒绝外站、协议相对路径、反斜线、控制字符、fragment、额外参数和重复参数。

资源 reader 必须在同一事务里按对象 kind/id 读取当前真实 revision 和授权所需绑定；需要保持版本一致性时锁定对象行，再用当前权限核验。返回其他对象、无版本或附带内容的宽投影均拒绝。reader 不得把 URL 自带的 expectedRevision 当作服务端当前版本。

## 后续整合与真实验收

以下仍未完成，不能将本目录作为 909/910/915 的生产起跑通过证据：

- 真实 Web 会话回查、企业微信映射、MCP 令牌、AgentAPI 账号绑定与撤销存储的 server composition；不创建实际 token 或新持久授权。
- 使用当前节点、来源性质和业务权限的材料/人员/需求/匹配领域适配器；受控 person 读取与投影仍等 X1 窗口。
- 917/919/921 固定输出 DTO 到位后的第三幕读取适配；不读取待裁决结论补齐字段。
- 普通深链的 Web 页面、登录安全回跳、实际对象 reader 以及领域事务/审计适配。
- 真实 PostgreSQL 下锁、回滚与并发撤权/版本改变；真实三入口同一身份等价结果；生产撤权/转发/切换账号/旧版本走查。
- X1 为新 auth/usecase 目录追加 Next/传输依赖边界规则；必要公共出口统一由 X1 提供。作者未改共享边界脚本。
- 897、899 实际合入 main。当前固定899组合的全量 typecheck 仍报 `person-test-helpers.ts:107` 缺少 `evaluationNodeId`，该受控文件不在本卡范围。

定向单测使用化名/合成材料和真实 899 节点策略；只模拟 I/O、身份发行端与事务端口。内存事务回滚测试只证明用例抛错/提交的边界顺序，不能替代 PG 原子性验收。没有加载供应商凭证、真实 token、外部连接、服务或 worker。
