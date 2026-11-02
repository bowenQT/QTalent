# BOW-923 演示事实导入与演示初始化

把 `tests/fixtures/bow-923` 的第六期判断对照事实导入正式工程的数据库：两份化名演示原表登记为原件、版本与逐行片段，93 个案例、两段判断和 HR 不可比标记写入 919 的 canonical 五张表。导入只读八个固定输入文件，不读 `scene.mjs`、预期 JSON 或任何计算结果；每个文件都要和代码里写死的 SHA-256 摘要一致。

## 夹具代与固定来源

| 代                     | 固定提交                                   | 用途                                      |
| ---------------------- | ------------------------------------------ | ----------------------------------------- |
| `bow-923-v3`（当前）   | `47870d6fc902fd810b608591d4f6709e46d34148` | 命令导入的唯一一代，按原型 Y 逐人数据重做 |
| `bow-923-v2`（已淘汰） | `6dff525b42f812423d981d12fd40aff8999cf00f` | 只供测试证明两代可以共存，命令不会导入    |

两代的差别集中在 `FACT_GENERATIONS`：固定提交、三项原档位的取值（v3 只能是 A / B / C，v2 用前段档位名）、manifest 是否带 `prototypeCommit`。一代的文件不能按另一代的规则导入。

每一代的持久化身份互不重复：批次、原件版本、案例、行出处、判断、对应表版本都由夹具按代派生；原件 ID 由导入器按代派生为 `<代>-original-front` / `<代>-original-back`。每一代是一份独立演示原件的第 1 版，所以数字列 `version` 固定为 1，不会撞键；「不写死」指的是原件 ID 按代派生。同一原件重新渲染时才会升 version。节点 ID 也随代更换（v2 是 `bow-923-xe6-*`，v3 是 `xe6-select` / `xe6-end`）。目录人员、期次 `b-xe6`、`xe-select-v1` 和量表是多代共用的事实。

## 运行时读取与摘要

发布包由 `deploy/release.mjs` 用 `git archive` 生成，没有 `.git`，所以运行时不调用 Git：读取包内（或 checkout 内）的夹具文件，核对写死的摘要。摘要等于该代固定提交下的文件摘要，可用下面的命令复算：

```sh
git show 47870d6fc902fd810b608591d4f6709e46d34148:tests/fixtures/bow-923/mapping.json | shasum -a 256
```

`sourceCommit` 仍作为事实出处写库。工作树里这八个文件一旦改动，初始化和导入都会在事务前失败，此时需要换代：新的固定提交、新的摘要和新的持久化身份。旧代 v2 的文件已不在工作树，只由测试从固定提交抽到临时目录读取。

## 输入校验

`readStandardIterationFactFiles(root, generation)` 从 `root/tests/fixtures/bow-923` 有界读取八个文件（`root` 是发布包或 checkout 根目录），逐个核对 `FACT_GENERATIONS[代].digests`，缺失报 `fixture_missing`，大小超限在有界读取时报 `fixture_too_large`，摘要不符报 `fixture_digest_mismatch`，错误只带固定文件名、不带路径；这一步在任何数据库事务之前。`prepareStandardIterationDemo(files, generation)` 校验 JSON 结构和内部一致性、两份 XLSX 与人工标记的 manifest 摘要，再逐格核对真实表格：整行表头、非日期列的文字类型、人员与期次、作品与同队、三项原档位、最终档位、评价人、UTC 数值日期、记录状态和引用原文。缺段的行仍登记片段，但不能有档位、评价人或日期。

XLSX 只用 Python3 标准库读取这两份经摘要核对的固定文件，设时间、输出和解压体积上限，不求值公式、不访问外链、不落临时文件。

## 命令

```sh
pnpm exec tsx src/server/db/seed/standard-iteration-demo/run.ts --init --as <账号ID>
pnpm exec tsx src/server/db/seed/standard-iteration-demo/run.ts --apply
```

两个命令都使用服务端 `getEnv()`，只拒绝 `APP_ENV=production`，不核验连接的到底是哪个库（后续改走部署受控入口）；不自动加入 `db:seed`。成功时只输出回执，失败只输出稳定的错误分类，不打印 SQL 原错、连接串或原文。两个命令都必须在发布包（或 checkout）根目录执行；在别处执行会报 `fixture_missing`，不写库。解两份 XLSX 需要 `python3`（只用标准库）：读取夹具之前，入口先用 reader 同一套解释器解析方式（当前 PATH 里的 `python3 -I`）加载所需模块，不满足就以 `python_unavailable` 退出，不写库。

### `--init --as <账号ID>`：幂等的演示初始化

`--as` 必须是当前有效的管理者账号；不满足时什么都不写。之后按顺序执行，每步一笔原生事务，重复执行安全：

1. **结营评委 `s-29`**：在目录里登记这一位演示人员（孟砚舟，组织 `tdc`，`noReview`、`demo` 为真，hue 318），字段取自原型 81e4fd4 的 `data.js`。不存在就插入；已存在就逐项比对，任一字段不同即失败（`directory_mismatch`，回执的 `fields` 列出不同的列名，不输出取值），不覆盖，此时后续步骤都不执行。只登记这一个人。
2. **节点**：在 `b-xe6` 下建 `xe6-select`（入营选拔（演示））和 `xe6-end`（结营评审（演示）），kind 为 `review`，并补齐 93 位学员的节点主体；每条已记录的判断，按「节点 · 学员 · 评价人」补一条 `judge` 评价关系，自判断时间起生效，评价人凭这条关系读自己的对照案例。关系 ID 由三者拼成，重跑不重复写入。节点已存在时逐项比对，不同即失败（`node_mismatch`），不覆盖。旧代的 `bow-923-xe6-*` 节点保持原样。
3. **基线**：还没有选拔标准 head 时，经 918 的 `initializeReviewedSelectionBaseline` 建立 `xe-select-v1`，生效时间 `2026-06-14T16:00:00.000Z`，内容取当前代的 `selection-standard.json`。已有 head 就保留，因为现场发布 v2 以后再初始化不能回退。
4. **第六期绑定**：经 918 的 `bindExistingSelectionCohort` 绑定 `b-xe6`，已绑定则沿用。在同一事务、同一把标准类别锁下，核对绑定的版本和内容与当前代的 `selection-standard.json` 一致，不一致就整笔回滚（`selection_binding_mismatch`），不留绑定和审计。
5. **导入**：调用 `importStandardIterationDemo`。

初始化分五个独立事务（s-29、节点、基线、第六期绑定、导入），某一步失败时，前面已提交的步骤不回滚（例如已新增的 s-29、节点）。可以靠重跑恢复的情况：

- 普通中断，或缺少前提（期次、目录人员、管理者授权）修好之后：已提交的步骤重跑返回 `unchanged`，从断点继续；
- 基线不相容（已有 head 的版本不是 `xe-select-v1`，或版本相同、内容不同）：第六期绑定和对内容的核对在同一事务、同一把标准类别锁下完成，不一致就整笔回滚，不留绑定和审计；修正基线后重跑即可；
- 并发两个初始化同时首次创建 s-29 或节点：其中一方可能因唯一键冲突失败，重跑即可。

不能靠重跑恢复、需要人工处理的情况：已存在但字段不一致的 s-29 或节点（`directory_mismatch` / `node_mismatch`），以及本修复之前就已写入的错误第六期绑定（原生绑定看到已有绑定会直接沿用，重跑仍报 `selection_binding_mismatch`）。

第六期已正确绑定 v1、之后 head 升级到 v2 的情况，重跑仍然成功：这时只比对第六期绑定本身，不比对当前 head。

回执逐步给出 `created` 或 `unchanged`，以及第七期 `b-xe7-demo` 当前是否存在。第七期不由初始化创建：现场先发布 v2，再经原生期次入口创建并绑定第七期。期次表没有日期列，「创建后的下一个周一开营、时长与第六期相同」只是现场说法。`DEMO_NEXT_COHORT` 导出下一期的固定描述，供生命周期装配使用。

### `--apply`：只导入

要求节点、基线和第六期绑定已经存在。导入在一笔 Read Committed 事务里完成：先取得 919 同一批次锁，核对目录人员（ID、演示标记、名称）和期次，登记原件、版本和片段，核对 918 的期次绑定与标准内容，再调用 919 的 `writeCanonicalComparisonBatch` 写入并完整读回。相同事实重放返回 `unchanged`；同一 ID 的事实不同即冲突，全部回滚。目录人员、账号和 grant 不由这里创建。

## 验证

```sh
pnpm exec vitest run src/server/db/seed/standard-iteration-demo/input.test.ts
pnpm exec vitest run --config vitest.integration.config.ts src/server/db/seed/standard-iteration-demo/import.integration.test.ts
```

PG 测试在隔离的 `_test` 库上使用正式迁移。正向用例里的节点、时间和账号是测试专用事实，不是演示环境的事实。覆盖：

- 发布工件：和 `prepare` 一样用 `git archive` 生成无 `.git` 的工件，CLI 的 PATH 里只有 `node` 和 `python3`、没有 git；从工件运行 `--init` 首次成功、重放 `unchanged`；包内夹具被篡改或缺失时回执只有稳定错误码和文件名，节点、基线、绑定、事实和 s-29 都没写；
- 无数据库的读取测试（`input.test.ts`）：从无 `.git` 的临时根读取并核对摘要，逐个篡改八个文件都被拒绝，缺失文件被拒绝，写死的摘要等于固定提交下的文件摘要；
- 当前代首导、重放、两个导入者等待同一批次锁、真实 CLI 首导与重放；
- 先导 v2、再导 v3、再重放 v3，三步都成功，v2 的行逐字节不变；
- `--init` 首次全部 `created`、再次全部 `unchanged`，`s-29` 缺失时插入、重复执行不变、已存在但名称/组织/hue/noReview 不同时拒绝且不写任何事实；行数和生效区间不变；真实 CLI 初始化与拒绝非管理者；旧代节点保留；已有节点 kind 不同时拒绝且不建基线；
- 目录、期次、绑定、原件、片段、对应表冲突时整体回滚，不覆盖已有事实。

## 演示库执行前提

- 目录里要有当前代用到的其余演示人员（由工程种子写入）。结营评委 `s-29` 是原型 81e4fd4 才加入的；工程种子目前固定在原型 91b297a，还没有这个人，所以由 `--init` 登记。`prototype-reference.json` 这次不升级：升级会让工程种子整体换到新原型数据，影响面超出本 PR，留到赛后。
- 本 PR 没有在演示库执行初始化或导入，也没有部署。
