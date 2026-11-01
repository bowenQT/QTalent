# BOW-923 真实演示事实导入

本目录接续已合 #267 的 bow-923-v2 输入。固定事实提交 `6dff525b42f812423d981d12fd40aff8999cf00f`；只从 Git 对象读取 seed-input、mapping、selection-standard、manual-comparability-marks、source-rows、manifest 和两份 XLSX。既不导入 scene/expected/expectedAtCreation，也不依赖工作树中可能改过的原表。

## 已实现输入入口

`readStandardIterationFactFiles(cwd)` 有界读取上述八文件；`prepareStandardIterationDemo(files)` 校验 JSON 结构/内部事实一致性、两份 XLSX 和独立人工标记的 manifest 字节摘要及真实表格后返回（其他 JSON 的来源完整性由生产入口的固定 Git 提交保证，prepare 本身不证明调用者字节来自该提交）：

- `canonical`：直接通过919固定 `f20fc48277dca9825ef80fdabec2a7ba30accc0f` 的 `validateCanonicalComparisonImport`，保留人×判断、原量表、两段状态、独立人工标记与来源血缘，没有计算结果或样本统计。
- `records`：两份独立演示原件、版本及唯一单行 fragment。原件 kind 为 original，显式标注化名重建；不替换既有 prototype_snapshot，不插维度分或原型历史评价副本。两段缺失事实仍引用原表实际存在的缺段说明行，不捏造评价人或时间。
- `selectionStandard`：实际原始三要点内容与版本，供918真实初始化入口核对；这不是发布命令或已建立的head。
- `requiredPeople` / `cohort`：导入前必须在已有目录核对的真实 ID/演示名称，不是创建人员、账号或grant的授权。

XLSX 读取只针对这两份经摘要核对的固定合成文件，使用现有CI已使用的 Python3 标准库 `zipfile` / `ElementTree`，不新增包。子进程只接收原表字节，设时间/输出/解压体积上限，不评估公式，不访问外链、不落临时原表；只接受实际固定文件的单工作表、显式字符串/数字/空单元格格式。核对两张表整行表头、所有非日期列的文字/空值类型，再校验 A/B 人员、C 期次、作品/同队、三项原档位、最终原档位、评价人、数字UTC日期、状态与引用原文。所有行和完整性基数均从输入/manifest核对，93/186及87/86只是当前固定输入的测试事实，不是网页统计答案。

## 原生事务与显式命令

`importStandardIterationDemo(db, repositoryDirectory)` 自己读取固定 Git 输入，不接受外部构造的 prepared plan。它在 Read Committed 单事务内先取得919同batch锁，锁后核已有目录 ID/演示名与期次，再用 X1 导出的原有 `insertChecked` 登记 originals / originalVersions / fragments。随后重读918实际期次绑定和不可变标准内容，调用919真实 `writeCanonicalComparisonBatch` 完成五表写入与完整读回。重复导入使用同一批次身份；已有ID逐字段比较，原件字节摘要、定位或原文不同即冲突，所有失败回滚。目录、节点、918 head/period/binding和当前grant一律不由923创建。

命令是 `pnpm exec tsx src/server/db/seed/standard-iteration-demo/run.ts --apply`。它使用现有服务端 `getEnv()` 配置，不加载凭据文件、不自动加入 `db:seed`，production 环境拒绝。只输出批次、源提交、输入基数和完整性摘要，失败只输出稳定分类，不打印 SQL 原错、连接串或原文。运行此显式命令仍须先满足下列事实前置，并另按环境授权操作；本PR没有执行演示库导入。

## 固定组合与验证

代码已接X1 `7dfbae71e672f6ef4cc6626e4668f98d2b395e6d`：包含919 `7770b9730a676e58bd44ba4276698e5a133e7a07`（原生store/usecase）、918 `92db986c73dd6042c53b7c1b47d546cf03bc438f`（真实初始化/绑定/标准读取）与现有insertChecked出口 `edbce681363f46449f7e2e361366c93b7332c380`。共享index冲突已由X1解决，本卡未改共享schema/出口/最终迁移。

**52项通过：29离线 + 23真实PG，0skip。** 原生测试覆盖：

- 固定93案例、186出处与4条独立人工标记首导成功，独立新连接读回完整canonical事实；前后实际present分别87/86，只作为输入完整性验证。
- 成功重放返回unchanged，事实摘要、原导入时刻、行数和当前grant不变。
- 外部测试事务先持同一实际batch锁，查询真实pg_locks确认两个导入者均在等待，释放后只有一份inserted、另一份unchanged，最终只一批完整事实。
- 缺绑定、错误绑定版本/内容、缺当前节点主体、原件/摘要/片段/映射冲突整体回滚；不从cohort推定节点主体，不覆盖已变更的原事实。
- 真CLI子进程首导和重放成功；缺绑定/原件冲突只有一行稳定错误JSON，连接关闭且无半批残留。
- 首轮输入审查N1/N2的6项实际XLSX反例旧实现6红→绿：完整表头和文字/空单元格类型。N3按实际manifest摘要与固定Git来源边界更正文档。

正向测试经授权仅在独立_test库建立**明确测试用途的**合法节点与合成reviewed时间；baseline/head/绑定全部通过918的 `initializeReviewedSelectionBaseline` / `bindExistingSelectionCohort` 原生入口、真实当前账号/grant和事务创建，没有直接插入918状态表。测试值只在integration测试中，不是实际923节点/历史时间裁决，不进入生产导入器或CLI默认值。初始化与绑定是918各自的前置事务；923comparison批次内部仍是一笔原生事务，没有假称三者共同提交。

验证命令：`pnpm exec vitest run --config vitest.integration.config.ts src/server/db/seed/standard-iteration-demo/input.test.ts src/server/db/seed/standard-iteration-demo/import.integration.test.ts --maxWorkers=2 --coverage --coverage.include='src/server/db/seed/standard-iteration-demo/{input,import,run}.ts'`。PG仅用test-db.env白名单、隔离_test库及X1受控原生升级迁移（通过 `QTALENT_COMPARISON_TEST_MIGRATIONS` 指定）。没有手写DDL或skip；测试库/所有连接/本人heavy槽在结束后清理。

三执行文件统一TypeScript覆盖行92.79%、分支95.45%；import.ts行/分支100%。实际CLI子进程不纳入该进程的V8计量，run.ts仪表值仍37.5%行/60%分支，但成功、重放、两类失败脱敏与退出/关连接已真实执行并断言；不能把子进程结果伪加进覆盖率。内嵌Python字符串也不受V8计量，真实XLSX正例、畸形ZIP和更新摘要后篡改单元格反例实际执行Python。

## 仍待正式依赖与实际场景验收

- 正式918/919迁移仍由X1在既定游标交付；上述临时升级结构的PG成功不是默认CI绿。默认CI已核当前缺表失败，不靠改测试目录默认值或跳过PG放行。
- 实际923 `xe-select-v1` baseline effectiveFrom 尚待批准事实；真实前后节点kind/cohort映射尚待裁决。它们只由真实918/899入口建立，本卡不拿测试时间、导入时间或首场日期当历史事实，不猜真实interview/defense，不空cohort绕过。
- 生产CLI目前仅消费、核验已经建立的真实binding，不自动初始化或绑定，避免两笔前置事务之间的版本竞态。CLI运行仍需要对应环境授权；本PR没有实际演示库执行、部署或供应商调用。
- 待前置PR/正式结构齐后跑默认正式检查，推进Ready/connector及X1门禁；真实三幕场景查询/来源打开另据批准事实验收，不以隔离测试当现场完成。
