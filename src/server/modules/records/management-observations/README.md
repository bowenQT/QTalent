# 独立管理观察（BOW-904）

本目录保存没有情境/行为/结果也能署名的主观看法，固定输出 `kind: management-observation`、`nature: management_observation`。不生成事件、分数或匹配证据，不调用模型。已提供领域用例、读取投影和 PostgreSQL 持久适配；公共出口、生产身份/来源组合、906 导入、档案读取与最终迁移仍由后续实际消费整合。

## 输入与读取

- `createManagementObservation` 只收正文、节点/人员、发生日期/时间、出处和操作编号。手写作者由服务端当前身份及姓名生成；不能传入作者、角色、分数或确认标记。手写记录可以没有附件。
- 面评导入要求当前范围内 HR。正文、面试官、面试日期及全部出处须与 `loadAttribution` 的可信解析结果一致。面试官与导入人分开保存，面试日期与导入时刻分开保存；已映射的面试官仍标为“写的人未在系统内确认”，未知身份不按名字猜测。导入署名和原始日期是历史快照，后续目录改名不重写它们。
- `noReview` 只排除被评价对象，不取消操作人的业务资格。操作人仍须有有效账号/人员绑定及非空署名，能否写/读继续由 `canCreateObservation` / `canReadObservation` 判断；正式 seed 的 HR、管理者、导师即使自己标记 noReview 也能在当前获权范围履职。
- 作者仅在当前评价关系内读取自己的观察；管理者、HR 按当前节点与人员权限读取。员工、系统管理员、已撤销/到期关系拒绝。原作者身份不形成永久访问权。
- 每一处来源须匹配真实片段及原件版本、位置和完整主体/性质。共享来源的所有主体与所需性质都可读才返回整条观察。缺失、重复、错版本或权限不明时拒绝/过滤；作者回看不授予其他主体或敏感性质的访问权。
- 返回字段白名单不包含内部操作、署名解析编号或录入账号。没有异步工作夹在最后权限快照与同步投影之间。

## PostgreSQL 适配器

`createManagementObservationPostgresPorts(database, facts)` 提供真实 `ManagementObservationPorts<Transaction>`。本目录没有默认内存 store、全局账号或放行策略。端口是服务端用例内部实现，不是可直接接受客户端调用的授权入口；`accountId` 必须来自已认证入口。

必须提供四个事务内的权威能力：

- `lockFacts(tx)`：锁住该次读取依赖的完整授权、归属与来源分类/引用事实，保持到事务提交；包含可能撤权、变更共有人或使来源失效的写集合。必须由拥有这些事实的组合层落实，不能传空函数。
- `loadSnapshot(tx, accountId)`：复用现有当前账号/899 节点授权读取，业务时钟在等待锁后读取，返回当前署名。最后快照也要重新取时间。
- `loadSources(tx, references)`：返回原件版本/位置与完整主体、性质及 requiredKinds，不能用客户端声明的分类。
- `loadAttribution(tx, id)`：返回可信面评署名/正文/原日期与出处，不能把导入人当原作者。

适配器先对 `accountId + operationId` 取得带模块命名空间的 PostgreSQL 事务 advisory lock，再在首次事实读取前等待 `lockFacts`，随后调用权威读取器；只接受由本 factory 创建且尚在进行的事务。使用 Read Committed，锁等待后的查询可见已提交的撤权。读取记录/回执与引用使用行锁；事实栅栏必须由组合层覆盖完整读集合，不能仅凭最后重读对象宣称跨入口并发撤权已解决。

持久表如下，唯一事实不镜像旧 `records_statements`：

| 表                                          | 内容和约束                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `records_management_observations`           | 正文、作者历史署名、导入人、两个时间与面评解析编号；关联既有节点主体，校验手写/导入归因组合 |
| `records_management_observation_sources`    | 有序片段引用；复合外键固定 fragmentId + originalVersionId，片段及位置不能重复               |
| `records_management_observation_operations` | actor + operation 主键、语义指纹与观察编号；复合外键保证回执属于该观察的录入账号            |

观察、全部出处、操作回执与 `recordAudit` 同一事务提交；任一失败整体回滚。重复操作仍先核当前权限与来源，同键变载冲突，不重复插入或审计。没有修改观察内容/署名/确认标记的 API。数据库约束与运行时模型共同校验；来源非空和导入署名真实性由模型/权威读取器负责，不能把 FK 存在性当授权或真实性证明。固定业务 `ObservationError` 保留原分类；其余事务错误统一投影为 `ObservationPersistenceError`，仅在存在时保留 SQLSTATE。没有 SQLSTATE 的连接/参数序列化/读取器异常同样不附原始 cause、SQL、正文或署名参数。

## 实际验证与边界

只用演示化名，在所有者指定 `TEST_DATABASE_URL` 上创建唯一随机 `_test` 库并在 afterAll 删除；不读连接串，不使用旧 55432 服务，不建立服务或持久凭据。测试从当前 Drizzle 定义生成内存中的临时结构，**没有生成或验证正式迁移文件**。

当前首审修复共 83 项：24 项事务 PG、5 项正式 seed PG、54 项领域/用例单测，在同一次运行汇总覆盖率：

- 无 SBI 落库/读回；面试官/导入人、日期精度、未本人确认与目录改名后的历史署名保持。
- 实际并发重放、actor 操作隔离、变载冲突及回执归属外键；来源顺序稳定、片段与原件版本复合外键。
- 员工、未知账号、跨节点、noReview、其他作者、撤权与共享来源全主体/性质过滤。
- 实际审计/账本约束失败回滚全部写入，读取损坏记录时拒绝，错误不携正文。
- 等待操作锁时撤权/关系恰好到期；真实授权表和原件表锁保持到提交；写入后时钟到期仍回滚。

首次缺少实现的 6 项测试真实失败后补适配；另临时遗漏事实锁，PG 并发撤权反例明确失败，随后按 SHA-256 原字节恢复并在上一阶段重跑 73 项通过。本次首审先以生产导入路径 `readPrototypeSeed → mapPrototypeSeed → importDemo` 导入摘要固定的正式化名 seed，再用 899 已有 `planLegacyEvaluationNodes` 生成测试期次节点/关系，未假造结营节点或更改人员标记。3 个正式业务账号原先均被拒，实际 Drizzle 无 SQLSTATE 异常也回显合成正文和署名；共 9 失败/74 通过的红证据后修复到 83/83。正式角色可新建/重放/读取，事件及评分记录数量保持不变；noReview 作为目标仍被拒，无权、过期及未知/系统管理员身份仍拒。首审修改计 1/2，沿用既有 Claude 请求复核增量。

精确提交、覆盖率和命令见 PR。单测最多 2 workers，真实集成与完整重检查先取得 heavy 槽，用完立即释放。

```sh
pnpm exec vitest run --config vitest.integration.config.ts src/server/modules/records/management-observations src/server/usecases/management-observations.test.ts --maxWorkers=2 --coverage --coverage.include='src/server/modules/records/management-observations/{schema,postgres,model,policy,read}.ts' --coverage.include='src/server/usecases/management-observations.ts'
pnpm exec tsc --noEmit --incremental false
pnpm exec eslint --max-warnings=0 src/server/modules/records/management-observations
pnpm check:boundaries
```

测试的当前权限由真实 `loadEvaluationContext`/899 SQL 读取，片段/版本为真实表；来源分类和面评解析署名是显式合成的可信外部边界，不能将其当生产 906/873 读取器。事实锁由该测试组合层对其实际读集合取得。生产读取器与完整事实锁、敏感读取审计、原件 API、档案及 854 全匹配链仍需在实际调用处整合并验证；本测试不代表这些已接通。观察保持管理观察性质，没有 events/statements 写入，原固定 854 过滤组合的旧证据不冒充本轮重跑。

## X1 整合

原三文件新增被拒的操作已确认未执行；本轮依所有者在 Codex 的直接确认恢复并完成，记录见 #248/6551983878、6552056378、6552124053。公共 records 出口、person 查询/投影/来源组合与原件接线仍由 X1 协调，本轮不写另派 837 的文件，不写 programs schema，也不增加第二套身份或来源表。

输入沿 904 原分支追加，消费 899 固定 `d5cf82fa264e022b8e4c928b008461e98c53293d`（原 `96fa3aa` 加最小受控夹具补丁）。897 新裁决的修订待 X1 重新冻结；本片没有擅自选边或重写共享契约。最终迁移仍由 X1 在 904/902 段串行生成，必须按实际 main 前置与当前门禁合入。PR 保留 Draft+blocked，生产整合和最终迁移未完成时不关闭整卡。
