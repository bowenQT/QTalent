# 规则版本的类别与生效读取（BOW-922）

前置契约：BOW-917 / PR #258，固定提交 `2fe52fa46a0003762b5090b0d5af97654f7f5b2c`。本卡只定义并读取版本的适用范围；没有起草、发布、期次绑定、历史重算或原型改动。

## 存储与读取

`ruleVersions` 保留原有身份、provenance 与 sourceCommit。新表 `ruleVersionApplicability` 用 versionId 一对一关联类别和生效区间，避免强迫旧 seed/夹具给新增列填错默认值。类别使用冻结的 `EvaluationRuleCategory`；数据库检查类别、版本前缀及有限的起止时间。不同类别可以各有当前版本。

`readEffectiveRuleVersion(db, { category, at? }, clock?)` 返回冻结的 `effectiveRuleVersionReadResultSchema`。未给 at 时只读取一次服务端时钟；有效区间为 `[effectiveFrom, effectiveUntil)`。没有适用元数据时返回 not_found；同类别出现多个有效区间时返回 conflict，不按 id、时间、锚点数或 provenance 猜一个。provenance 从原版本行返回，不把 demo_import_snapshot 改成 published。

本函数是授权后的领域读取端口，不授予证据权限。BOW-845 的整理用例应显式请求 dimension_anchors，再按返回 versionId 读取该版本锚点；不在全表挑唯一 published 版本。BOW-918 只在确认生效时维护适用区间，并在同一事务关闭前版区间；本卡不实现其生命周期。

## 已知旧版的回填

`planLegacyRuleVersionApplicability(versionIds, usages)` 只识别 rubric-v1 → dimension_anchors 和 xe-weekly-v1 → xe_weekly。未知版本不兜底归到 rubric。usages 是调用方已经验证的 `{ ruleVersionId, usedAt: Date }` 证据；每版取最早已知使用时间作为适用起点，不将它冒称发布时刻。缺时间或含无效时间时返回明确 unresolved。

`backfillLegacyRuleVersionApplicability(dbOrTransaction, usages)` 仅给两个已存在且缺少适用元数据的旧版补齐记录。任一待补旧版缺时间时整体不写；已有起止区间不覆盖，允许重复调用。未知版本和原 provenance/sourceCommit 不动。它只供显式数据迁移或 seed 事务调用，不能混入 Web/worker 启动。

X1 的演示导入适配应在同一事务中先写 ruleVersions，再传入经过校验的 seed.evidence.events 与 historicalEvaluations 中非空 ruleVersionId 和 occurredOn（日期规范为该日 UTC 起点）。已有数据库由受审的数据回填步骤提供各版本使用证据；如果没有可追溯日期，保留缺口并报告，不能用部署时间补假历史。

## X1 整合清单

- 公共出口：index.ts 导出 ruleVersionApplicability、readEffectiveRuleVersion / EffectiveRuleVersionReadResult、planLegacyRuleVersionApplicability、backfillLegacyRuleVersionApplicability / LegacyRuleUsage。作者不改公共出口。
- 跨域导入：src/server/db/import.ts 接入上述回填；不改原始事件/分数/来源内容。最终迁移和已有库的数据回填在 899 合入后由 X1 串行完成（游标第 2 位），作者不提交最终 SQL、snapshot 或 journal。
- 917 进入 main 后将最新 main 合回本任务分支，核对相对 main 的净 diff 不再包含契约前置；不 rebase 或强推，不带入 #185 的业务代码。

## 验证边界

单测验证旧版分类和证据计划。真实 PostgreSQL 集成测试验证双类别并存、返回锚点所属版本、时间边界、冲突/未找到、回填的幂等与原数据保留，以及 FK/唯一性/类别/时间的数据库约束。

X1 的最终迁移未落盘前，可以将当前迁移副本放进临时目录，由 Drizzle 生成本卡增量，再通过测试专用 BOW_922_TEST_MIGRATIONS_DIR 指定。测试仍需显式 TEST_DATABASE_URL，只接受 loopback 且以 _test 结尾的测试入口；每个测试文件创建随机测试库并清理。没有真实 PostgreSQL 就失败，不跳过、不用 fake。该覆盖只证明明确的 main + 固定917 + 本卡 + 临时生成迁移组合，不代表 899 或最终串行迁移已经验证。
