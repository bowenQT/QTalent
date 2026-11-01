# 节点结论原生存储与事实读取（BOW-902）

本目录承接 #275 的领域与事务用例，提供真实 PostgreSQL 版本、历史和操作回执。`usecases/node-conclusion-native.ts` 已普通消费 X1 固定 `ca0ea8759b217e9841cb656c0948af631adadec0` 的真实保存/撤回/复核/原始来源账本，不再缺整个 selector。仅服务端内部组合，无认证路由、页面或供应商调用。

## 已实现

- 节点/人员唯一身份，expectedVersion CAS 追加不可变历史；指定旧版本不回退 latest。操作账本以账号/operationId 唯一，精确指向原版本。结论、操作、审计同事务回滚，结论不生成关键事件或普通评分。
- 五列存储 decoder 严格核原始 payload 和原生身份列，返回深冻结副本，损坏行安全 conflict。#275 最后换绑修复 c6dc17e 普通消费，未修改其最后2/2范围或重置历史。
- 原生组合依次获取 READ COMMITTED ledger 实际全局短事务写栅栏、完整当前授权关系锁，再进入已有 operation/结论身份锁和领域用例。不会传旧页面身份、在等待前保留旧快照或跨模型网络持锁。
- `inspect` 仅范围内HR可用，取得实际人工确认ID、评分人、revision、时间及稳定 ledger digest。逐条核原save/operation所有权、acceptedDecision、绑定AI与原引用、真实旧规则锚点。active只是候选过滤，不是完成资格。
- 当前来源使用同一个完整 ledger 图，保留原事件、历史、intake共同主体及 requiredKinds；通过现有 `projectTalentRecord` 与领域来源权限检查。不可读证据抑制整条确认；历史结论和operation重放也先核当前源/定位与完整共有人许可。
- 现有历史读取与operation重放真实可用。换绑不能继承旧署名操作；有权限的新HR仍可读历史。缺省/非法输入保持原usecase验证结果，不能额外提交ready快照。

## 完成资格待所有者裁决

当前 schema/ca0 没有权威的“本轮应确认评委×维度/材料集合”或完成关闭修订证明。既有规则明确禁止按当前评价关系数量、active评分条数或任务完成推断到齐。

因此真实事实完整时也返回 `unavailable` 与 `confirmation_scope_not_recorded`；有未处理原生review时为 `pending`，同时保留完成资格缺口。原确认、保存、建议、来源、锚点、review来源缺失均分别列明原因。仅把review状态改resolved不能证明已正式校准，返回 `review_resolution_unverified`。

根编排已将“保持已齐并冻结本轮集合”与“改为允许缺项人工结论”的选择交所有者裁决（#248/6563184463及后续）。本片不代替产品决定，不新增可注入ready回调。**新的HR节点结论确认目前明确conflict，不宣称save→HR新结论成功全链已通。** 已有历史读取不会因此全部关闭；其权限和引用仍按当前事实重新验证。

## 测试边界

真实PG测试通过846实际保存生成确认和复核，验证事实摘要、原署名/版本/时间、撤回变化、完整共有人拒绝、数据库锚点复合FK，以及历史读取/operation在等锁期间撤权、到期、换绑后的拒绝。

历史结论由测试直接建立预存版本，依据取实际846确认；它只验证历史读取/重放，不冒生产新确认成功。三个事务错误分类为显式注入，用于验证安全错误投影，不能称真实PG故障。存储CAS/外键/原子性由真实SQL套件另验，既有领域/用例单测继续执行。

统一验证在显式注入测试库和已核定迁移目录后运行：

```sh
pnpm exec vitest run --config vitest.integration.config.ts \
  src/server/modules/programs/node-conclusion.test.ts \
  src/server/usecases/node-conclusion.test.ts \
  src/server/usecases/node-conclusion-native.integration.test.ts \
  src/server/modules/programs/node-conclusions/stored-version.test.ts \
  src/server/modules/programs/node-conclusions/postgres.integration.test.ts \
  src/server/modules/programs/node-conclusions/store.integration.test.ts \
  --maxWorkers=2 --coverage \
  --coverage.include=src/server/modules/programs/node-conclusion.ts \
  --coverage.include=src/server/usecases/node-conclusion.ts \
  --coverage.include=src/server/usecases/node-conclusion-native.ts \
  --coverage.include=src/server/modules/programs/node-conclusions/postgres.ts \
  --coverage.include=src/server/modules/programs/node-conclusions/store.ts \
  --coverage.include=src/server/modules/programs/node-conclusions/stored-version.ts
```

PG只加载指定test-db.env，化名随机隔离 `_test` 库，用完关闭连接并删除；测试前CAS heavy槽，用后按token释放。X1受控目录固定86b2ca2（三表schema fec6079），运行前逐文件核manifest、正式0000–0009/journal前缀及schema blob。临时新增迁移不是正式编号，不复制进仓库，不替换默认CI。`BOW902_TEST_MIGRATIONS`仅供显式受控验证；默认缺表必须失败，没有CREATE TABLE或skip兜底。

具体受检SHA、当前统一结果和覆盖率见PR/#248，不沿用旧137项覆盖新代码。原生范围独立交叉审查可先进行；生产新确认仍待上述资格裁决，正式SQL、公共出口/认证入口和页面由X1/对应卡收口。Draft与Ready以本片实际代码、正式迁移和当前CI门禁为准，不把交接或临时PG通过当整卡完成。
