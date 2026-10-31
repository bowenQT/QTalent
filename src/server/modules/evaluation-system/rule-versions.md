# 规则版本的类别与生效读取（BOW-922）

前置契约 BOW-917 已由 main `5726fd5d0cd6457d762327829adc002b1dda41b3` 合入，来源冻结 `832209d177944b5ce18577794acb88314a6460da`。本轮沿 #265 原分支普通合并该 main；八个旧前置的 add/add 冲突全部取 main 原样 blob，不修改契约。时间存储方案依据 #248 评论 6547780983。

## 生效区段与读取

`ruleVersions` 保留版本目录、provenance 与 sourceCommit。`ruleVersionApplicability` 每次生效保存一行，以 periodId 为主键，versionId 外键允许多段；类别、版本前缀、有限时间约束保留。类别来自冻结的 EvaluationRuleCategory，不从来源属性或生命周期推断。

v1→v2→恢复v1保存为 v1=[t0,t1)、v2=[t1,t2)、v1=[t2,∞)。恢复时新增区段，不延长第一段，也不改写中间窗口。区段不反向依赖918表；918发布/撤销回执保存实际periodId，供后续配对撤销和generation栅栏使用。

内部允许 [t,t) 留存同毫秒操作的区段身份；数据库拒绝反向和无限时间。公开读取仍只返回正区间。`readEffectiveRuleVersion(db, {category, at?}, clock?)` 按左闭右开选取；没有元数据返回 not_found，同类别多个有效区段返回 conflict，即使它们属于同一versionId。不给at时只读一次服务端时钟，不按id、来源或锚点数量猜测。公开响应仍使用原 effectiveRuleVersionReadResultSchema，不增加periodId或更改字段。

读取是授权后的领域端口，不授予来源权限。845显式取dimension_anchors，再按返回版本取锚点；918按期次取已持久化的不可变binding，不用global current替换旧绑定。类别切段不修改既有分数、锚点、档案或快照。

## 事务类别锁与选择标准切段

`lockRuleCategory(tx, categoryOrCategories)` 要求显式Transaction，使用内置 `pg_advisory_xact_lock(hashtextextended('qtalent:rule-category:' + category, 0))`。多类别一次传入，去重后按稳定顺序获取；所有区段写入者都须遵守，不增加扩展、服务或安全权限。

`switchSelectionApplicability(tx, {expectedPeriodId, newPeriodId, versionId, at})` 只写xe_selection：

1. 取得类别事务锁，锁定并重读已有区段，核对版本目录真实存在、newPeriodId未使用、有限时刻和全部非空区段不重叠。
2. 既有未来起点/终点、回拨时间、历史重叠或过期expectedPeriodId均抛RuleApplicabilityConflictError（code=conflict）。没有当前段时expectedPeriodId必须显式为null；不猜基线内容或伪造published目录。
3. 将唯一当前开放段的终点写为at，追加新开放段并返回实际内部区段记录。历史闭合段保持不变；相同毫秒可闭成空段，新periodId保证身份不同。

本端口没有操作ledger；重复使用旧periodId或newPeriodId会冲突。918在自己的事务中先查当前授权的operation ledger，重放成功后不能再次切段。该函数只负责存储区段，不把provenance当发布状态，也不实现918的确认、生命周期、影响预览、审计或期次绑定。

918的调用顺序必须是：Read Committed事务→类别锁→actor/operation和实体栅栏→重载当前身份/权限/业务时钟→本端口与head generation/publication CAS、两侧生命周期、不可变内容、审计和ledger一起提交。switch内部会重取同一事务锁；传入at须由调用方在先取得锁后生成，不把等待前的缓存权限/时钟当最新事实。后续失败必须从事务回调抛出使全部写入回滚；本轮不宣称918全流程已验收。

## 已知旧版回填

`planLegacyRuleVersionApplicability(versionIds, usages)` 只识别rubric-v1→dimension_anchors和xe-weekly-v1→xe_weekly，periodId固定为legacy:&lt;versionId&gt;。每版只取已验证使用事实的最早usedAt；缺时间或含无效时间返回unresolved，不使用导入/部署时间，不给未知版本默认类别。

`backfillLegacyRuleVersionApplicability(tx, usages)` 现在只接受显式Transaction。先按稳定顺序锁住两个已知类别，再重新检查哪些目录版本尚无任何区段；存在任意历史段（包括已闭合或多次恢复）就全部保留，不覆盖旧起止或重新索取旧证据。任一待补版本缺时间则整体抛错；并发回填等待锁后重查，只生成一次固定起始记录。provenance/sourceCommit及未知版本保持原样。

生产importDemo已在原事务中先写验证过的ruleVersions，再传入seed事件/历史评价的非空ruleVersionId与occurredOn（UTC日起点）；本轮不改import.ts。现有数据库回填同样必须提供可追溯使用日期，不能把缺口当当前日期补齐。

## X1接线与迁移

- 已有公共index不由作者改。本轮需追加实际实现：lockRuleCategory、switchSelectionApplicability、RuleApplicabilityConflictError，以及SelectionApplicabilitySwitch / RuleApplicabilityPeriod两个类型。作者给出精确head并停止writer后，X1沿原分支追加。
- 最终迁移仍在899合入后排第2位由X1生成；本轮只把已提交迁移复制到/tmp，由Drizzle生成临时增量，未提交SQL/meta/journal，也不改写已发布迁移。
- 当前正式迁移没有applicability表，默认集成/CI仍可能因42P01失败。临时组合通过只能证明该明确组合，不能冒称默认CI或最终串行迁移通过。最终表与存量显式回填落地后，还须在真实升级路径复验。

## 验证范围

保留原25条回填/导入单测及原33项PG组合的适用断言，区段ID与显式事务按本次模型更新。真实PG新增覆盖v1→v2→v1时点、三个类别隔离、同毫秒空段、旧period/未来/回拨/重叠冲突、锁等待后的CAS、稳定多类别顺序、legacy并发幂等、缺日期与迟发失败回滚、旧终点和来源保留。

测试入口只接受loopback且库名以_test结尾的TEST_DATABASE_URL；每个文件自行创建并清理随机测试库。BOW_922_TEST_MIGRATIONS_DIR仅显式临时组合可设置，默认CI仍走提交目录。不缺库跳过、不用fake替代PG。完整重检查先取得本机heavy槽，单测maxWorkers=2；不读取供应商或真实员工材料。
