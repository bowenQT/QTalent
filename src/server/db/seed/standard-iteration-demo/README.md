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

## 固定组合与仍待完成的验收

目前代码组合919 `7770b9730a676e58bd44ba4276698e5a133e7a07`（真实store/usecase及读回修复）、X1 `e1573eaaa3f3d28e785f3300a73f341241e2298d`（共享出口，含5f551e3原生结构/918入口）和 `edbce681363f46449f7e2e361366c93b7332c380`（仅导出现有insertChecked）。没有复制表、重造持久化算法或提交临时SQL；正式迁移仍由X1按游标提供。

- 918 实际 `xe-select-v1` baseline 的 effectiveFrom 尚无批准事实。只能由918真实初始化入口建立，再绑定期次；923不以导入时间/首场日期猜生效点。
- 前后实际节点 kind/期次映射仍待所有者裁决；923不猜 interview/defense、不把两段塞进唯一program_cohort节点，不设置空cohort绕过。已有节点/主体由919真实读回验证。
- 上述事实未齐，**完整93人正向导入、成功重放、成功并发、后续网页联验尚未完成**。当前测试没有在真实923节点上填猜测类型，也没有伪建918 baseline/head/binding。不能凭总体覆盖率或919自己的合成PG代替这些验收。

首批实跑35项：23项离线输入/CLI门禁 + 12项真实PG反例。首轮Claude输入审查通过后的N1/N2另补6项真实XLSX表头/类型反例，旧实现6红，修复后纳入统一复验；N3按实际固定Git来源与manifest校验范围更正此文档。PG覆盖缺绑定后190条原件/版本/片段全部回滚、同批并发失败零残留、人员缺失/姓名错/非演示拒绝、期次缺失/错误拒绝、准确演示后缀兼容、原件/摘要/最后片段冲突保留既有事实、相同原件重放后下游拒绝仍不重复。没有创建授权。

验证命令：`pnpm exec vitest run --config vitest.integration.config.ts src/server/db/seed/standard-iteration-demo/input.test.ts src/server/db/seed/standard-iteration-demo/import.integration.test.ts --maxWorkers=2 --coverage --coverage.include='src/server/db/seed/standard-iteration-demo/{input,import,run}.ts'`。只在隔离_test库使用test-db.env及X1原生临时迁移目录（由 `QTALENT_COMPARISON_TEST_MIGRATIONS` 指定），运行前领取heavy槽，测试库/连接/本人槽运行后清理。

当前三文件统一TypeScript覆盖行90.78%、分支91.94%；import.ts正向写入/成功返回与标准不匹配分支尚待上述事实，run.ts实际成功命令未验。V8不统计内嵌Python字符串：真实XLSX正例/畸形ZIP/更新摘要后的单元格篡改反例确实执行Python，但不能把TypeScript覆盖率称为Python覆盖率。
