# 证据模型（BOW-834）

## 身份与职责

- `originals.id` 是原件身份，`originalVersions.id` 是不可混淆的版本身份；每版本保留摘要和原件内版本号。`fragments` 的位置只属于该版本。
- 公共引用为 `fragmentId + originalVersionId + location`。`location` 与 BOW-836 对齐：`document { page?, paragraph }`、`spreadsheet { sheet, cell }`、`recording { startMs, endMs }`，全部带 `kind`。页为正整数，段落/工作表/单元格非空，时间段为非负整数起点且终点大于起点。
- 一个可评分 `events` 只有一个 `personId`。其他参与人仅在 `eventParticipants`；多人独立事件可共用 `eventSources`，不会自动把团队分复制到个人。重复来源关系不可产生重复评分。
- `statements.kind` 将原始事实、本人自述、管理观察、AI 推断、人工结论分开存储。AI 必须具备模型版本且不能署人工作者；人工记录不能伪装为 AI。原文只经后续授权读取用例返回。
- 片段不冗余存授权结果。读取用例必须沿全部 `eventSources` 找出完整相关人员及内容性质，再交授权入口；单个可见事件不意味着共享片段中的其他人员也可见。

## 规则与评分

`evaluation-system` 存维度与只读规则/锚点版本；事件保存时记录版本。锚点的 ID、维度、版本和值由复合外键一起匹配，不能把旧版引用拼到新版事件。

`talent.aiSuggestions` 与 `talent.confirmations` 独立存储。`scored` 只能是 1–5 整数且需要锚点；`unknown` / `not_demonstrated` 数值与锚点为空，不等于 0。所有评分引用必须属于相同事件，不能借另一事件的片段补齐证据。

有效人工确认唯一键为 `eventId + dimensionId + evaluatorId`，不是 personId 或来源。历史修订另有 revision 唯一约束及前序复合外键，保留原评价人/原值和修改人/理由；修改事务由后续用例实现。本卡不提供修改 API，不声称数据库声明可阻止具备任意 SQL 权限的操作者改写历史。

评分复核可表达分差、改 AI 分无理由、冻结后位置变化；这里只声明原因，不实现触发器。没有冻结档案、象限或规则修订表，迁移外键不级联删除历史。

## 演示导入：待决边界

沿用同一固定摘要加载器，仅读取 `data-xe6.js`、`data.js`，不运行 `store.js`。`DIMS`、`ANCHORS` 映射成显式标记的演示快照规则版本。`EVENTS` 原记录保存在 `importSnapshots`，其 `sourceCommit + fieldPath` 只证明原型字段位置，不冒充原观察表证据。单人且具备 SBI 的事件可保留，但缺原件版本/位置/锚点指针/模型版本的评分不能被实现代码偷偷补成已验证结论。

当前 Draft 仅保留快照与 ID/缺字段报告，不写入有效确认；是否以明确标注的原型历史演示分进入特定展示口径，正由用户与协调人讨论，尚未形成最终产品规则。本 PR 不宣称完整演示评分导入 AC 已完成，也不增加必须访问真实 HR 文件的产品验收前置。

导入返回 `{ gaps: [{ recordId, missing }] }`，CLI 只输出该报告，不输出评价原文。所有插入在既有事务中；重复同基线不覆盖已存在记录。结构关系在源映射阶段验证，数据库约束再次验证。

## 迁移、验证和恢复

SQL 与 metadata 用 `pnpm db:generate` 生成，不手改。BOW-834 为本轮首个迁移，后续迁移卡须等本卡合入后从最新 main 重生成。首次/重复迁移、外键与 CHECK 失败、并发唯一键、修订历史、重复导入、全批回滚测试位于 `db/seed/evidence.integration.test.ts`，只允许随机独立 loopback `_test` 库，不跳过或换成 fake。

应用启动不迁移。此迁移为加表，无既有表回填；恢复优先停用相关入口并保留新增历史数据，不能把代码回退当作数据恢复，也不自动 DROP 生产表。原型来源缺口与真实 PostgreSQL 验证在 PR 分别报告。

## 工程责任校准

主协调人授权本卡独占 `db/import.ts` 与就近测试、三个新领域入口，以及 `scripts/check-boundaries.ts` 的窄声明例外：schema 经其他领域 index 仅在 pgTable 内声明 FK；别名表导入不享例外，运行时跨域读写和内部路径仍拒。没有放开目录、工厂或跨域运行时表操作，不改既有 directory/programs/staffing schema。此为已确认外键合同的工程落实，不改变产品要求。
