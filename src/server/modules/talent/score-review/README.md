# BOW-849 · HR 评分复核

支持 `rater_gap` 与 `ai_gap` 两条人工复核路径。`keep_score` 只适用于 AI 分差，同样必须填写人工理由；第三类 `recalibration` 仍返回 `not_connected`。不生成总分、排名、百分比，不把 AI 建议当作人工确认。

## 已实现

- `service.ts` 沿用现有 `review-queue.ts` 合同。服务端取得当前 HR 身份和节点/人员范围，读取原双方及证据后再复核权限；署名和时间来自服务端。相同 operation/语义可重放，异义、旧修订或不同 operation 重复处理冲突。等待期间换绑、撤权或收回范围不能沿用旧权限；旧回执的签署人必须与当前操作人一致。
- `calibration-write.ts` 严格验证写计划、原双方摘要、目标范围、签署、规则版本与完整引用并集，复用 service 的唯一 digest。这个纯校验不提供权限，不从结果猜原 action，也不证明锚点真实存在。
- `usecases/score-review.ts` 提供真实数据库的当前 HR 身份、范围过滤和 `resolveNativeScoreReview` 内部命令。HR 自身 `noReview` 不阻止履职；被评价人和完整来源的权限限制仍生效。客户端仅传 action，不能传权限、任意 personId 或原始评分替代服务器事实。
- 原生命令使用 READ COMMITTED，在同一事务先取得 `readLockedRecordLedger` 的实际全局短事务写栅栏，再锁住当前授权关系、锁后重读业务时钟和身份。完整共同主体与 requiredKinds 复用 `projectTalentRecord`；任何一条证据不可读就拒绝整个评分/回执，不只隐藏链接。
- 双方来自精确确认 ID、save 输入和已绑定的 AI suggestion；`acceptedDecision` 里的 action/reason 才是人工修改理由。确认行中的撤回/重存谱系说明不能冒作用户理由。旧规则锚点核对 ID、维度、版本、值和文本。当前 review 合同不支持的来源位置明确不可用，不强转新类型。
- 私有 `postgres.ts` 保存不可变校准，CAS 关闭 review 并推进 revision，在同一事务/保存点写 operation 和审计；任一步失败全部回滚。operation 通过精确四列外键引用原校准署名，回读核验原始摘要、范围及 payload 一致性。数据库错误按安全 conflict/不可用投影，不返回 SQL、原始评价、署名或 cause。
- 两个原人工确认及 AI 建议保持原样，不插第三个普通评分人，不平均冲突。`sourceFactRevision` 是写前证据；自身关闭 review 会改变整个 ledger 摘要，不能用这个变化误判历史校准失效。合法重放仍核当前精确原确认、来源和权限。846 的真实撤回在后续 HR 校准后拒绝删除原保存。

本代码没有启动供应商、公开 route 或默认 demo 身份。`queries/score-review.ts` 仍是显式依赖注入的组合接缝。原生命令已可在真实 PG 中执行，但尚未接应用 action、工作台和公共有效评分投影。

## 固定共享输入与剩余门禁

基线 main `fe34b6faffcfb2832a1be266a155f0d7d19d69cc`；已合 #268 不重开。独立安全修复 #319 (`1ea8469cbb8a612be736a3bb57509838fb1b6086`) 普通消费到本分支，`digest` 的单行 export 仅在本续作。

共享 ledger 使用 X1 `ca0ea8759b217e9841cb656c0948af631adadec0`（#322，继承 #316 完整来源图）。结构使用 X1 `91de39976617c624389277715ef0bedff34aeb19`：`scoreReviews.revision`、`scoreReviewCalibrations` 和 `scoreReviewOperations`。作者没有改共享 schema、出口或生成最终迁移。

X1 后继必须完成：

1. 按正式迁移游标生成 SQL，保留已落历史迁移；受控临时迁移不占正式编号，不能替代默认 CI。
2. 唯一有效评分投影按精确原确认/来源仍有效才应用校准，保留原双方历史，不插第三普通 rater。重叠冲突继续复核，不按最新时间挑选、不平均，不改档案版本或冻结象限。
3. 应用 query/action、工作台和待办共同消费真实 review 关闭状态及当前权限，验证刷新/重启后消失。当前命令已关闭数据库 review，不等于所有 UI 待办已接通。
4. #316/#322/#319 与正式结构依赖合入，当前头完整 CI 和 Claude 交叉审查通过后，才能给本片 Ready / ready-to-merge；整卡生产余项继续跟踪。

## 验证

仅化名隔离 `_test` 库；需要数据库的进程只加载 `test-db.env`。重检查先 CAS 获取资源槽，单测 `--maxWorkers=2`，结束删除测试库并关闭连接。运行本卡原生 PG 需要 X1 核定的迁移目录；可用 `BOW849_TEST_MIGRATIONS` 指定它，默认仍是正式 migrations。目录缺结构直接失败，没有手写 CREATE TABLE、mock PG 或 skip 兜底。

定向统一命令（在已注入测试库和已核定临时结构的进程中）：

```sh
pnpm exec vitest run --config vitest.integration.config.ts \
  src/server/modules/talent/score-review/service.test.ts \
  src/server/modules/talent/score-review/calibration-write.test.ts \
  src/server/modules/talent/score-review/postgres.integration.test.ts \
  src/server/usecases/score-review.integration.test.ts \
  --maxWorkers=2 --coverage \
  --coverage.include=src/server/modules/talent/score-review/service.ts \
  --coverage.include=src/server/modules/talent/score-review/calibration-write.ts \
  --coverage.include=src/server/modules/talent/score-review/postgres.ts \
  --coverage.include=src/server/usecases/score-review.ts
```

测试用真实846保存生成两类复核，核保留原分/理由、精确外键、持久单赢家/重放、事务与审计回滚、撤回保护、完整来源拒绝及等待期间撤权/到期/换绑/原确认失效。仅安全错误投影测试注入事务错误；它不冒充真实数据库故障证据。具体受检 SHA、运行结果和覆盖率写在 PR 及 #248；旧端口/元数据测试数字不能替代新增原生代码验证。
