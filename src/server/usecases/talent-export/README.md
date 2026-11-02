# 已确认内容导出（BOW-912）

服务端按当前管理者 / HR 权限读取已确认关键事件维度分，并提供 CSV。它不是盘点冻结结果，不包含总分、排名、百分比、AI 建议分或未经人工确认的推断。

## 接口与数据来源

- `readTalentExportForCurrentUser()`：实际 Access / Better Auth 会话认证，返回 `ready.data.scopes`，只含范围、人数和三个时间范围的条数 / 已跳过数。认证、权限、事实读取失败分别是 `unauthenticated`、`forbidden`、`unavailable`，不伪装为空结果。
- `generateTalentExportAction(scopeId, range)`：对应 BOW-841 `ExportPort.generate` 的 `done / denied / empty / failed` 结构。`done` 包含当前生成的已确认分条数、人数、实际导出时刻和普通同源下载链接。
- `GET /api/talent-export?scopeId=...&range=...`：真实请求重新认证、重新读取并重新生成；匿名 401、无权 403、输入无效 400、范围为空或读取期间变化 409、事实 / 审计不可用 503。响应私有且不缓存；请求没有文件 token、持久文件或授权能力。生成时拿到的链接不能让撤权后的账号继续下载旧内容。
- `preparePersonPrintContentAction(personId)` / `readConfirmedPersonExportForCurrentUser`：同一套当前授权、复核排除、二次读取及审计，只返回 `partial` 的单人已验证核心。没有采用摘要、正式象限位置、岗位 / 职级 / 工龄或完整隐藏内容提示的可靠读取来源，这些列在 `unavailableSections`，不返回完整 `PersonPrintSheet` 或 `printed`。没有修改 BOW-911 的页面、组件或前端端口；前端仍需接线与验收。

范围由服务器提供：`all`、真实期次 `cohort:<id>`、真实评价节点 `node:<id>`。调用者不能提交账号、人员列表或任意范围扩大权限。仅当前 manager / hr grants 参与；系统管理员和导师身份不能导出，混合 HR + 评价人账号也不能用评价关系扩大范围。

时间范围为 `all / last12Months / last3Months`，按业务时钟的事件日期取包含下界的自然月区间；月末按目标月最后一天收敛，不包含业务时钟之后的事件。CSV 的导出时刻取真实服务端时钟并标明 Asia/Shanghai，另列业务口径日期，演示业务时钟不冒充真实导出时间。

事实只读既有权威表：directory 当前账号和 grant、899 当前节点权限、records 原件版本 / 片段 / 完整来源与参与人、talent 当前 active confirmations / 原生 scoreReviews、规则版本与行为锚点。复用 BOW-846 的 `talent-source-projection`，不复制来源权限算法、不从 person.effective 猜复核已排除。

## 过滤与事务

先按当前权限投影完整来源和事件的全部参与人，再计算导出与已跳过数；不可披露来源不会变成可观察的隐藏计数。导出有行为锚点、评分人、规则版本、真实来源与确认性质的当前维度分。演示基线明确标记且不编造人工确认时刻。

任何仍 open 且未撤回的复核都排除关联确认，包括 AI 差距未写理由。原生 confirmationId / counterpartConfirmationId 精确关联；已知 legacy 双 null 按事件维度整体排除，不替新确认猜关联。已撤回事件、无效 / 未确认分不输出；未知归属或撤回列使读取不可用，不默认 false / null。引用保留全部合法事件来源及准确页段 / 时间点；确认没有准确来源关联时不任选第一条。

Pg store 使用 Read Committed。生成、下载、单人核心准备各自重新读取当前事实；写成功审计后用新时钟再读一次，授权、复核、来源、确认或撤回变化即回滚成功审计并拒绝返回之前的内容。失败 / 拒绝审计另开事务；审计不可用时不返回文件。只审计当前账号、阶段、结果及条件摘要，不存导出原文或请求头。

CSV 对每格 RFC 转义，并阻止空白、不可见控制字符前缀的公式注入。文件名只用服务端时间，业务文本不进入响应头。

## 代码依赖与剩余接线

本 PR 代码依赖：BOW-846 **#289** 固定 `09084000d7d606efe172355844a611616b77c964` 的来源投影、原生 `events.withdrawnAt` 和复核归属 / 撤回列。开发分支没有复制这些文件或提交迁移；main 基线尚无该模块时不能独立编译 / 测试。验证在 main `325de93fde83987bdcdffa10cf00bb70e91e07c3` 普通合该固定输入的隔离组合中完成，不冒充当前 main CI 通过。

卡片剩余范围依赖：BOW-841 **#256** 批量导出 UI 消费；BOW-911 **#291** 单人打印 UI 消费；完整单人摘要 / 正式位置 / 身份字段仍缺权威生产读取。仅 `partial` 核心不代表完整打印交付。本卡不修改前端、公共出口、schema、worker、包、锁文件或最终迁移。

## 验证方式

定向单测使用 `--maxWorkers=2`，替换认证或存储 IO 边界，真实来源权限 / 策略 / 用例和 Request→Response 处理照常执行。它们不是浏览器或真实 Cookie 的端到端验收。

真实 PG 用例只从指定凭证文件加载 `TEST_DATABASE_URL`，校验本机 `_test` 入口，创建并清理本次唯一随机测试库；仅运行固定依赖已有的正式迁移，不补手写表。覆盖真实确认 / 来源读取、AI gap 复核、撤权、不可披露共享来源、撤回、事务期间另一连接提交复核、单人核心同样受控。没有有效 PG 入口就失败，不 skip / fake。运行前领取共享重测槽，结束立即释放。

最终 PR 记录受检 SHA、实际命令、统一单测 + PG 覆盖率与未验证边界。没有供应商调用、真实员工资料、部署或新资源。
