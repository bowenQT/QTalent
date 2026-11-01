# 节点人工结论（BOW-902）

已交付独立领域、事务用例和原生 PostgreSQL 的事务／锁／当前授权读取基础。结论表持久化、生产权威来源和页面尚未接通。原第一片为377f92c693edf724811f4fc830fb9c501b093c28，本轮普通合入main325de93fde83987bdcdffa10cf00bb70e91e07c3；897来源契约和899授权现在均从实际main单源消费，没有复制上游文件。

## 人工结论

本片只接受defense节点；范围内HR确认，管理者只读。评委确认本人评分的权限不等于节点结论确认权。本片不给评委/员工节点结论读取权限，不自动生成面试录用/转正结论，不接AI或人事执行状态机。

记录含稳定ID、节点/人员、conclusionType=defense、origin=human_conclusion、版本、人工原文、服务端署名及真实wall-clock确认时间。expectedVersion=0表示尚无记录；修订追加下一版，旧版原文/署名/依据保留。纯模型深冻结新对象，不修改旧版；数据库不可变性仍待适配验证。

严格请求只接受operationId、节点/人员、expectedVersion、expectedScoreRevision、conclusion和basisReferences；不接受actor/role/time/eventId或客户端自报确认状态。expectedScoreRevision仅作乐观锁，必须等于846权威快照。引用保留897原件版本/精确定位，不能凭一段文字冒充来源。

## 必需的权威端口

NodeConclusionDependencies全部方法必需；缺评分、来源、事务或持久方法时构造失败，没有默认ready/allow-all或生产内存库。

- readScoreConfirmations：846按其完整评委确认规则返回ready/pending/unavailable/null；ready须含同节点/人员、实际确认修订与非空人工确认ID/评价人/版本/时间。902不从分数、active标记、任务完成或当前关系数量猜测是否到齐。缺状态或修订已变返回conflict，不形成结论。
- resolveSources：873/908解析真实引用，返回完整共同主体、来源种类及requiredKinds。每个主体和所需内容种类通过899当前source-read，且含当前节点与人员。缺来源/主体、重复解析、定位变化、越界均拒绝，不剥离限制或重标来源。
- loadAuthorization：锁后在同tx按当前业务时钟加载账号绑定、目录署名、节点/主体/关系与grants；来源等待后再核当前权限。新确认还拒绝处理中账号绑定变化。权限用业务时钟，签名时间用真实时钟。
- 读历史/重放也校验当前权限及来源；重放只返回原版本，不读最新评分重算或重复签署。未知存储异常继续抛出，不冒充成功或空集。

领域测试验证保存和解析引用的端口约束；原生PG测试另验证真实899读取和锁，未验证结论表保存、原件打开或HTTPS。没有写records_events或records_statements，也没有伪造事件关联。

## 事务与幂等

同一事务依次锁account+operationId、节点/人员结论身份，锁后加载当前权限。同键异语义conflict，同键成功重放仍先授权；新确认加载当前版本/评分确认/来源，再核权限和两种版本。appendVersion以expectedVersion执行CAS，追加版本、审计和操作回执同事务提交，失败全部回滚。

引用按稳定字符串键排序形成语义指纹，不依赖系统语言。指定历史版本必须精确返回该版，不能回退latest。纯领域返回不可变对象；真实adapter必须保证追加唯一、跨进程并发及重启历史。

事务应沿899已验证的Read Committed+锁后授权；不能在等锁前固定旧快照。846确认、来源/授权并发变更与提交的协调仍须真实adapter验证。内存串行/故障注入不是PostgreSQL证据。

## 原生 PostgreSQL 基础与待接结构

`node-conclusions/postgres.ts` 的 `createPostgresNodeConclusionContext(db)` 提供真实 Read Committed 事务、account-operation 和节点/人员两级事务 advisory lock、真实 `loadEvaluationContext` 与当前目录署名。JSON元组区分锁命名空间；身份锁在第一条结论记录尚不存在时也有效。调用顺序仍由现有用例保证先operation后identity，再读权限。账号不存在、系统管理员、空署名拒绝；数据库失败保留为异常，不转换空集或成功。该工厂只返回这四个已实现方法，不能充当完整生产用例，也没有内存存储回退。

X1共享请求在#248评论6558273036：稳定身份node/person唯一且复合FK指899主体；不可变追加版本含精确人工署名、真实时间、完整评分确认快照和来源；account-operation唯一指纹及原成功版本FK。表名和布局由X1冻结，最终迁移仍按主链后的902窗口生成；作者不创建schema、DDL、journal、snapshot或临时建表SQL。

拿到实际schema SHA和受控迁移后，才在同一私有adapter补：原生身份行锁、当前/指定历史读取、expectedVersion CAS追加、同tx `recordAudit`、持久操作回执及精确旧版本重放。待验收的真实PG行为是：并发同请求只追加一次；两个旧版本竞争只有一个成功；新实例读历史、旧请求返回原版而非latest；审计或回执实际写入后失败整笔回滚；成功结论不新增事件或分数。当前事务回滚测试只在隔离库更新目录行，不是结论/审计/回执原子性证据。

846评分权威、873/908完整原件主体与定位仍需真实冻结接口；没有接口就不提供可运行的生产confirm，不从active分、人数、任务状态或客户端JSON构造ready/来源许可。897/899已合不代表这些前置完成。

建议后续由对应writer新增 `server/actions/node-conclusion.ts` 和 `server/queries/node-conclusion.ts`，从服务端会话解析account，分别调用既有confirm和read；前端840只消费受权结果，不传署名或权限。当前不写这些入口或档案读取，未宣称页面可用。

## 验证边界

原第一片在899/897固定原blob组合上验证领域与用例；本轮已切到实际main依赖，未放宽schema或权限。专项覆盖显式包含两个原生产文件和新增postgres.ts，85%阈值保持。领域测试涵盖HR/管理者/评委分工、伪造署名拒绝、缺846状态拒绝、两类版本冲突、历史保留、完整来源权限、幂等重放和内存事务竞争/回滚。来源等待撤权曾真实返回success，修后应forbidden。

本轮 `postgres.integration.test.ts` 使用随机专属本机 `_test` 库，仅从实际main迁移创建结构，结束只删除自己建的库。真实PG覆盖RC隔离级别与回滚、当前899范围和目录署名、未知/管理员/空署名拒绝、两级锁的真实等待（观察PG等待状态）及等待期间撤权、当前业务日到期、数据库失败不吞错。命令为 `node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts --maxWorkers=2 src/server/modules/programs/node-conclusion.test.ts src/server/usecases/node-conclusion.test.ts src/server/modules/programs/node-conclusions/postgres.integration.test.ts`；运行前依协作规范取得heavy槽，只在测试进程source指定环境，不输出连接信息。

结论表持久化仍等待X1结构和迁移；真实评分/原件接口、认证入口和页面未接。未运行原件API、浏览器、供应商或部署；保持Draft/Part of BOW-902，不以原生锁通过宣称整卡或持久化完成。
