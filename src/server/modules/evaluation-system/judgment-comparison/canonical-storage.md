# BOW-919 canonical facts 持久化

本目录的原生持久层保存人×判断、原量表和人工标记，不保存对照结论或统计答案。既有 calculation/projection 不变。输入 schema 与类型以 `canonical-input.ts` 为唯一实现；输入校验、原生五表存取及跨域同事务 usecase 已实现。公共出口与五表/918 受控结构待 X1，真实 PostgreSQL 验证尚未运行，不能把源码提交当持久化通过。

## 私有接口冻结

```ts
import type { Transaction } from '@/server/db/client';
import type {
  CanonicalComparisonImport,
  CanonicalComparisonSnapshot,
} from './canonical-input';

validateCanonicalComparisonImport(input: unknown): CanonicalComparisonImport;
writeCanonicalComparisonBatch(tx: Transaction, input: unknown): Promise<{
  status: 'inserted' | 'unchanged'; batchId: string; factsDigest: string;
}>;
readCanonicalComparisonBatch(tx: Transaction, batchId: string):
  Promise<CanonicalComparisonSnapshot | null>;
```

生产调用路径为 `src/server/usecases/judgment-comparison-canonical.ts`；本域 `canonical-store.ts` 只做五表真实存取。跨域目录、节点和来源验证由 usecase 复用各域公开表出口，同一事务执行。路径调整已明确核准并登记于 [协调记录](https://github.com/bowenQT/QTalent/issues/248#issuecomment-6560606327)。这些是 server-private 函数。923 在同一个真实事务中登记 records 原件/片段，再调用 write；函数不自建连接、不提交外层事务。异常必须传播至外层事务以完整回滚。导入按批次业务键加事务 advisory lock；相同事实重放为 unchanged，同 ID 异事实为 conflict，不静默吞冲突。reader 的 null 仅表示成功查询后该批次不存在，缺表、SQL 错误、缺段或不完整内容均为错误。

`CanonicalComparisonSnapshot` 返回 `facts`、真实期次绑定的 `selectionStandardVersionId`、完整性 `factsDigest` 和首次导入 `importedAt`。不包含 outcome、分布、样本门槛结果或 confirmedAttributions；不能在 921 尚无真实归因读取时默认补空数组。

## 输入与来源

输入为 batch、mapping、cases、manualMarks。确切字段见 `CanonicalComparisonImport`。两段各为 present 或显式 missing；不能以不存在的 stage 行代表 missing。present 的人类确认、评价人、时间、原量表和独立来源必须真实存在。manualMarks 是有署名/时间/理由的独立事实，不从 expected/scene 反推。一个人可以有多个明确判断，不按人取最后一行。

source 只返回 fragmentId、originalVersionId、rowPersonId、row；rowPersonId 必须等于 case 的 personId。实际行号从 records 的唯一 spreadsheet location 读取，不落重复列。完整 XLSX 字节、人员 ID/姓名列的验证由 923 原件导入负责；仅有引用 ID 不证明已验证字节。前后段必须来自不同原件，不能用同一原件的两个版本代替。

允许的八个来源文件摘要固定在 `canonicalInputFiles`，不接受 expected、scene 或其他统计文件。records originals/versions/fragments 继续唯一保存原件元信息、摘要、位置与片段正文。内部核对原件 kind、版本 commit/path/digest、单行位置，再用于事实完整性摘要；不双写正文、位置、历史评价或统计。

对外私有 snapshot 不返回 excerpt/location、原件名、路径、下载地址或凭据。fe-920 独占 Web loadBatch 和当前身份/节点关系复核，再调用现有 917 投影。原始 snapshot 不可直接送模型。可读一行不推出完整原件可下载；完整原件继续由 873 检查完整披露范围。历史 HR 签字不生成当前 grant。

## X1 结构边界

唯一 schema/公共出口/最终迁移归 X1。精确请求：[五表及节点待决](https://github.com/bowenQT/QTalent/issues/248#issuecomment-6560312469)、[事务/披露接口](https://github.com/bowenQT/QTalent/issues/248#issuecomment-6560357791)。私有作者不写 DDL。

| 表                                 | 不可变事实和关键约束                                                                                                                                     |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| evaluation_comparison_mappings     | version_id PK、原量表双 ID、三行对应关系、确认人/ISO 时间、来源 commit/文件摘要/nature                                                                   |
| evaluation_comparison_batches      | id PK、名称/真实 cohort/映射 FK、来源 commit/合同 SHA/fixture 版本、输入文件摘要、case 数、facts_digest、首次 imported_at、nature                        |
| evaluation_comparison_cases        | id PK、batch/人员/双节点、显式 judgment id/name、individual/team/work；两节点不同；双 node/person FK；不按 person 唯一                                   |
| evaluation_comparison_stages       | case×front/back PK、batch/case FK；present 的判断/来源/评价字段全有，missing 显式理由且判断字段全空；真实 fragment/version 组合 FK；batch 内判断 ID 唯一 |
| evaluation_comparison_manual_marks | id PK、case UNIQUE FK、理由/署名/ISO 时间/来源摘要/nature；输入的 batch/person/双节点与 case 一致                                                        |

batch 在同事务先插以满足立即 FK，再插 cases/stages/marks；事务提交前核完整读回与摘要，事务外仍全有或全无。source ISO 时间使用文本保留原始小数精度，运行 imported_at 使用数据库时间。摘要不代替 FK/形态/完整性约束。

918 固定输入为 PR269 的 `69e57cc90e44835eaecba99cddec8a79b867dfa9`。实际绑定表 `evaluation_selection_cohort_bindings` 与内容表 `evaluation_selection_version_content` 尚不在本基线 main；只读其真实绑定/版本内容，不复制 lifecycle 或保存第二个 current version。所有 present 前段必须匹配期次绑定。没有受控结构不运行假 PG 或把缺结构当空数据。

`selection_review` / `graduation_review` 的真实节点种类仍待所有者决定；不能猜 interview/defense、别名同节点或用空 cohort 绕约束。此项只阻真实 923 节点准备和联验，不阻输入校验、原生存储实现与合法合成隔离 PG。

## 当前验证与剩余

基线 main `71f8d9de99bb6e2abf36049571414aed9d3f7b4d`。输入单测覆盖独立来源、显式缺段、人×判断、重复 ID、三档对应、人工标记目标/时间、禁止答案/授权伪输入、摘要来源和无隐式改写。原生并发/回滚/外部来源漂移反例位于 `src/server/usecases/judgment-comparison-canonical.integration.test.ts`，待 X1 结构后执行，不宣称 PG 或完整三幕查询通过。输入校验定向覆盖率行 100%、分支 96%（31 单测），只覆盖输入层，不能替代原生层覆盖率。

测试库仅从 test-db.env 加载；完整重检查先领共享 heavy 槽，单测 maxWorkers=2。禁止读取真实材料，不需要供应商请求。最终真实 Web 查询、918/923/921/873/908 接线和节点裁决仍分别由原负责窗口承担。

真实 PG 测试默认使用正式迁移目录；临时组合时可由操作方将 `QTALENT_COMPARISON_TEST_MIGRATIONS` 指向 X1 原生生成的受控迁移目录，不接受手写 DDL。测试建立唯一随机隔离 `_test` 库，并清理自身连接和库；合成合法节点仅验证存储，不冒充真实 923 节点映射。
