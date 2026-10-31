# 节点人工结论（BOW-902，第一片）

只交付独立领域和服务端事务端口编排，不是生产数据库/页面接线。起点main5726fd5d0cd6457d762327829adc002b1dda41b3，消费899固定96fa3aa8e9858c76db2125ac5ab79764f45d45ab的真实节点授权，以及897固定0b20a913621121848219e0966ba4bf4844d1bdb3的MaterialSourceReference。上游文件未复制到任务分支。

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

这里只验证保存和解析引用的端口约束；没有真实原件打开、HTTPS或数据库验收。没有写records_events或records_statements，也没有伪造事件关联。

## 事务与幂等

同一事务依次锁account+operationId、节点/人员结论身份，锁后加载当前权限。同键异语义conflict，同键成功重放仍先授权；新确认加载当前版本/评分确认/来源，再核权限和两种版本。appendVersion以expectedVersion执行CAS，追加版本、审计和操作回执同事务提交，失败全部回滚。

引用按稳定字符串键排序形成语义指纹，不依赖系统语言。指定历史版本必须精确返回该版，不能回退latest。纯领域返回不可变对象；真实adapter必须保证追加唯一、跨进程并发及重启历史。

事务应沿899已验证的Read Committed+锁后授权；不能在等锁前固定旧快照。846确认、来源/授权并发变更与提交的协调仍须真实adapter验证。内存串行/故障注入不是PostgreSQL证据。

## X1后续窗口

本轮只改node-conclusion两个生产文件、两个测试和本说明，不改programs/schema.ts、公共index、person、904、922、918或共享文件。

建议后续单独批准src/server/modules/programs/node-conclusions/下schema.ts、postgres.ts、postgres.integration.test.ts：结论身份/追加版本、account-operation账本和审计；节点/人员复合FK指899 evaluationNodeSubjects，身份唯一、当前版本CAS、旧版本不可更新。首次无记录时使用身份锁，不制造占位事件。

X1接真实loadEvaluationContext/目录署名、846确认快照、873/908完整来源；公共index只追加实际符号，Next动作/工作台/档案DTO由对应writer接入。最终迁移在854之后的904/902阶段由X1原生生成，本卡无SQL/journal/snapshot。真实PG须验证并发仅一次、等锁与来源等待撤权、迟发失败回滚、原件回查、重启历史和无事件/评分副作用。

## 验证边界

隔离组合仅使用两个上游原blob：899 src/server/authz/evaluation-node.ts，897 src/contracts/sources.ts；未放宽schema或权限。两个生产文件显式专项覆盖，85%阈值保持。测试涵盖HR/管理者/评委分工、伪造署名拒绝、缺846状态拒绝、两类版本冲突、历史保留、完整来源权限、幂等重放和内存事务竞争/回滚。来源等待撤权曾真实返回success，修后应forbidden。

任务分支仍等待897/899及真实端口、最终迁移。未运行本卡PG、原件API、浏览器、供应商或部署；保持Draft/Part of BOW-902，不以端口或引用JSON通过宣称整卡完成。
