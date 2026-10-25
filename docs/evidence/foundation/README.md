# BOW-830 验证记录

依据：原 [工程基础规格](../../research/2026-10-25-y-architecture-alignment/engineering-foundation-prompt.md)，基础 main `565672ee7eb0bf52c81f21dfd21b15185e08696e`；原型配置只在根 `prototype-reference.json` 定义一次。该固定提交的 76 个 prototype/y blob 与实施初始快照逐个比对一致。

## 已实际执行

- Node 24.22.1、pnpm 11.25.0；锁文件安装，`pnpm peers check` 无 peer 冲突。
- `pnpm reference:prepare --verified-snapshot`：76 个固定 blob 校验、缓存准备。快照无 Git 历史，因此显式使用已核验快照路线；普通 checkout/CI 使用 `pnpm reference:prepare` 从固定 Git commit materialize，不随工作树变化。
- `pnpm format:check`、`pnpm lint`（含 AST 引入边界）、`pnpm typecheck`、`pnpm build` 通过。
- `pnpm exec vitest run --coverage`：仅无需 PostgreSQL 的单元测试通过；行 94.89%、分支 95.38%、语句 94.86%、函数 89.74%。这是补充口径，**不是**要求的单元+真实集成统一门禁通过。
- 原型 store 在隔离 VM 实际执行，管理者/HR/导师项目逐 ID 与顺序为 22/22/19，可选 full 人员为 93/93/0；管理员业务硬拒绝。
- `pnpm db:generate` 生成 17 张表的初始 SQL 与 Drizzle 元数据；未手改生成内容。
- Playwright e2e/visual 的 `--list` 成功，只证明用例发现及导入，不是浏览器通过。

## TDD 与独立审查

先写失败测试再实现，红绿覆盖授权有效期、多身份不交叉拼权、范围外人员、项目事务幂等与冲突、配置/Access 真验签、worker 握手与心跳、适配器假实现边界、UI校验和重复点击。

回归中实测暴露并修复：原型历史项目类型与新建表单枚举不同；日期格式差异；校验失败时 disabled 输入无法获焦；任务注册失败时 pg-boss 未停止；包装型 PostgreSQL 序列化冲突未映射；工作树原型与冻结基线耦合；AST 门禁漏拦直接 Node/数据库包与跨域表导入。没有降低阈值或整体排除逻辑来通过。

## 尚未通过的验收

- 云端 PostgreSQL 服务 socket 绑定被沙箱拒绝；官方提权环境初始化也失败，未绕过限制。真实 PostgreSQL/Drizzle 并发事务、pg-boss 任务、实际 WebSocket、浏览器功能及同次视觉比较尚未在此环境通过。单用户 SQL、IO doubles、单元覆盖均不替代它们。
- `pnpm test:coverage` 使用单元+真实 PostgreSQL 全集；缺 TEST_DATABASE_URL 时 suite 明确失败，不自动 skip/降级。CI 配置 PG17 隔离服务并运行同一门禁，实际 CI 结果须按 PR 当前 SHA 核对。
- 图像差异尚无数值结果、未产出通过截图；遮罩、阈值与路由范围见 [映射表](../../reference-route-map.md)。登录/账号菜单原型没有对应页，不做截图比较。
- U-15 所指仅存于其他研究工作区的 v21 / API 研究材料未入 main，本任务未声称已阅读；不补造其 Accepted 决定。
- 未部署、未合并、未调用真实供应商服务、未配置真实凭据、未调整仓库权限或 required checks。保留 Draft；GH22/BOW-830 不自动关闭。

## 依赖与风险

版本取自初始化当天 npm 官方包元数据并写入锁文件；来源/许可证原始核对见 dependency-review*.txt。实际使用 Next 16.4.3、React 19.3.1、Tailwind 4.3.3、Motion 14.6.0、Drizzle 0.45.4、Better Auth 1.7.12、pg-boss 12.38.0。

最新 TypeScript 7 / ESLint 10 超出 Next 的现有插件支持范围，经 peer 检查后选择最新兼容 TypeScript 6.0.3 / ESLint 9.39.5；后者官方已标 EOL，保留可见维护风险，待上游插件支持后升级。Node 类型使用 24.19.2 对齐 Node 24。server-only 0.0.1 为 Next 官方建议的 MIT 边界包。没有引入新供应商或新的服务类别。

恢复：撤回本分支应用代码；初始迁移仅新增表，本卡不触发线上迁移、回滚或删除。测试清理只针对自己创建的随机隔离库。
