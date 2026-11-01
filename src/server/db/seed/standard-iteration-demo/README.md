# BOW-923 真实演示事实导入

本目录接续已合 #267 的 bow-923-v2 输入。固定事实提交 `6dff525b42f812423d981d12fd40aff8999cf00f`；只从 Git 对象读取 seed-input、mapping、selection-standard、manual-comparability-marks、source-rows、manifest 和两份 XLSX。既不导入 scene/expected/expectedAtCreation，也不依赖工作树中可能改过的原表。

## 已实现输入入口

`readStandardIterationFactFiles(cwd)` 有界读取上述八文件；`prepareStandardIterationDemo(files)` 校验 JSON、字节摘要和真实表格后返回：

- `canonical`：直接通过919固定 `f20fc48277dca9825ef80fdabec2a7ba30accc0f` 的 `validateCanonicalComparisonImport`，保留人×判断、原量表、两段状态、独立人工标记与来源血缘，没有计算结果或样本统计。
- `records`：两份独立演示原件、版本及唯一单行 fragment。原件 kind 为 original，显式标注化名重建；不替换既有 prototype_snapshot，不插维度分或原型历史评价副本。两段缺失事实仍引用原表实际存在的缺段说明行，不捏造评价人或时间。
- `selectionStandard`：实际原始三要点内容与版本，供918真实初始化入口核对；这不是发布命令或已建立的head。
- `requiredPeople` / `cohort`：导入前必须在已有目录核对的真实 ID/演示名称，不是创建人员、账号或grant的授权。

XLSX 读取只针对这两份经摘要核对的固定合成文件，使用现有CI已使用的 Python3 标准库 `zipfile` / `ElementTree`，不新增包。子进程只接收原表字节，设时间/输出/解压体积上限，不评估公式，不访问外链、不落临时原表；只接受实际固定文件的单工作表、显式字符串/数字/空单元格格式。校验 A/B 人员、C 期次、作品/同队、三项原档位、最终原档位、评价人、数字UTC日期、状态与引用原文。所有行和完整性基数均从输入/manifest核对，93/186及87/86只是当前固定输入的测试事实，不是网页统计答案。

## 原生导入前置

目前尚未提供可运行的数据库导入命令，不自动加入 `db:seed`，输入通过不代表第三幕已入库。

- 919 同事务 `writeCanonicalComparisonBatch` / `readCanonicalComparisonBatch` 实现与 X1 五表结构待稳定 SHA；本卡不写其私有文件/schema，也不复制临时表或存储算法。
- 三类 records 登记请求 X1 导出现有 `db/import.ts` 的 `insertChecked`，冲突后逐字段检查，禁止静默吞差异。
- 918 `initializeSelectionBaseline` 要求既有 xe_selection 目录和开放生效区间，再以真实入口绑定期次；923不创建目录/period/head或伪publisher。前后节点种类仍待所有者裁决，不能由同cohort猜授权、猜interview/defense或设置空cohort。
- 实现后以一batch原生事务和同batch锁写入。records先登记、919 batch可同事务先插满足FK，完整性核验后提交；任何冲突或失败全回滚。HR历史签字不产生当前权限。

本卡真实PG只使用 `test-db.env`、隔离_test库和合法heavy槽；当前输入验证无数据库、供应商、凭据或服务。合入/应用联验仍须明确这些前置，不能将本目录输入校验PR当作整卡完成。
