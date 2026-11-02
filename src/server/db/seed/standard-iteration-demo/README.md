# BOW-923 演示事实导入与演示初始化

把 `tests/fixtures/bow-923` 的第六期判断对照事实导入正式工程的数据库：两份化名演示原表登记为原件、版本与逐行片段，93 个案例、两段判断和 HR 不可比标记写入 919 的 canonical 五张表。导入只读固定 Git 提交里的文件，不读工作树、`scene.mjs`、预期 JSON 或任何计算结果。

## 夹具代与固定来源

| 代                     | 固定提交                                   | 用途                                      |
| ---------------------- | ------------------------------------------ | ----------------------------------------- |
| `bow-923-v3`（当前）   | `47870d6fc902fd810b608591d4f6709e46d34148` | 命令导入的唯一一代，按原型 Y 逐人数据重做 |
| `bow-923-v2`（已淘汰） | `6dff525b42f812423d981d12fd40aff8999cf00f` | 只供测试证明两代可以共存，命令不会导入    |

两代的差别集中在 `FACT_GENERATIONS`：固定提交、三项原档位的取值（v3 只能是 A / B / C，v2 用前段档位名）、manifest 是否带 `prototypeCommit`。一代的文件不能按另一代的规则导入。

每一代的持久化身份互不重复：批次、原件版本、案例、行出处、判断、对应表版本都由夹具按代派生；原件 ID 由导入器按代派生为 `<代>-original-front` / `<代>-original-back`。每一代是一份独立演示原件的第 1 版；同一原件重新渲染时才会升 version。节点 ID 也随代更换（v2 是 `bow-923-xe6-*`，v3 是 `xe6-select` / `xe6-end`）。目录人员、期次 `b-xe6`、`xe-select-v1` 和量表是多代共用的事实。

## 输入校验

`readStandardIterationFactFiles(cwd, generation)` 从固定提交有界读取八个文件；`prepareStandardIterationDemo(files, generation)` 校验 JSON 结构和内部一致性、两份 XLSX 与人工标记的 manifest 摘要，再逐格核对真实表格：整行表头、非日期列的文字类型、人员与期次、作品与同队、三项原档位、最终档位、评价人、UTC 数值日期、记录状态和引用原文。缺段的行仍登记片段，但不能有档位、评价人或日期。

XLSX 只用 Python3 标准库读取这两份经摘要核对的固定文件，设时间、输出和解压体积上限，不求值公式、不访问外链、不落临时文件。

## 命令

```sh
pnpm exec tsx src/server/db/seed/standard-iteration-demo/run.ts --init --as <账号ID>
pnpm exec tsx src/server/db/seed/standard-iteration-demo/run.ts --apply
```

两个命令都使用服务端 `getEnv()`，production 环境拒绝；不自动加入 `db:seed`。成功时只输出回执，失败只输出稳定的错误分类，不打印 SQL 原错、连接串或原文。

### `--init --as <账号ID>`：幂等的演示初始化

`--as` 必须是当前有效的管理者账号；不满足时什么都不写。之后按顺序执行，每步一笔原生事务，重复执行安全：

1. **节点**：在 `b-xe6` 下建 `xe6-select`（入营选拔（演示））和 `xe6-end`（结营评审（演示）），kind 为 `review`，并补齐 93 位学员的节点主体。节点已存在时逐项比对，不同即失败（`node_mismatch`），不覆盖。旧代的 `bow-923-xe6-*` 节点保持原样。
2. **基线**：还没有选拔标准 head 时，经 918 的 `initializeReviewedSelectionBaseline` 建立 `xe-select-v1`，生效时间 `2026-06-14T16:00:00.000Z`，内容取当前代的 `selection-standard.json`。已有 head 就保留，因为现场发布 v2 以后再初始化不能回退。
3. **第六期绑定**：经 918 的 `bindExistingSelectionCohort` 绑定 `b-xe6`，已绑定则沿用。
4. **导入**：调用 `importStandardIterationDemo`。

回执逐步给出 `created` 或 `unchanged`，以及第七期 `b-xe7-demo` 当前是否存在。第七期不由初始化创建：现场先发布 v2，再经原生期次入口创建并绑定第七期。期次表没有日期列，「创建后的下一个周一开营、时长与第六期相同」只是现场说法。`DEMO_NEXT_COHORT` 导出下一期的固定描述，供生命周期装配使用。

### `--apply`：只导入

要求节点、基线和第六期绑定已经存在。导入在一笔 Read Committed 事务里完成：先取得 919 同一批次锁，核对目录人员（ID、演示标记、名称）和期次，登记原件、版本和片段，核对 918 的期次绑定与标准内容，再调用 919 的 `writeCanonicalComparisonBatch` 写入并完整读回。相同事实重放返回 `unchanged`；同一 ID 的事实不同即冲突，全部回滚。目录人员、账号和 grant 不由这里创建。

## 验证

```sh
pnpm exec vitest run src/server/db/seed/standard-iteration-demo/input.test.ts
pnpm exec vitest run --config vitest.integration.config.ts src/server/db/seed/standard-iteration-demo/import.integration.test.ts
```

PG 测试在隔离的 `_test` 库上使用正式迁移。正向用例里的节点、时间和账号是测试专用事实，不是演示环境的事实。覆盖：

- 当前代首导、重放、两个导入者等待同一批次锁、真实 CLI 首导与重放；
- 先导 v2、再导 v3、再重放 v3，三步都成功，v2 的行逐字节不变；
- `--init` 首次全部 `created`、再次全部 `unchanged`，行数和生效区间不变；真实 CLI 初始化与拒绝非管理者；旧代节点保留；已有节点 kind 不同时拒绝且不建基线；
- 目录、期次、绑定、原件、片段、对应表冲突时整体回滚，不覆盖已有事实。

## 演示库执行前提

- 目录里要有当前代用到的全部演示人员。结营评委 `s-29` 是原型 81e4fd4 才加入的，工程种子读取的原型基线里还没有这个人，处理方式待裁决。
- 本 PR 没有在演示库执行初始化或导入，也没有部署。
