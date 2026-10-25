# Niu-Talent

七牛云内部的人才识别、追踪与盘点工作台。AI 提供可追溯的建议，正式结论由有权限的人确认。

设计系统已定稿，高保真可交互原型正在评审，目标是完成 UI/UX 定稿。原型是独立 HTML、CSS 和 JavaScript，AI 行为用预置结果按真实节奏流式输出；正式应用、后端与 CI 尚未建立。

## 原型

原型有两条平行的方向，都分桌面版和手机版，各自带一份设计系统：

| 版本 | 位置 | 内容 |
| --- | --- | --- |
| 版本 X | `prototype/app/`、`prototype/m/` | 按需求定稿 v1.6 实现：CEO、HRBP、部门负责人、导师、员工五种视角，Landing 第三期等演示数据 |
| 版本 Y | `prototype/y/` | 中性工作台：管理者、HR、导师三种角色，人员是 XEngineer 第六期的演示数据；手机版只给导师用。管理者是公司层视角，看人、找人，确认规则与方案；整理档案和校准由 HR 做 |

演示人员都是化名并标「演示」。顶栏的视角切换只是演示手段，不是权限实现。

### 本地查看

在仓库根目录运行：

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory prototype
```

然后访问 `http://127.0.0.1:4173/`，这是评审导览页，列出走查路线和两个版本的入口。常用页面：

| 页面 | 地址 |
| --- | --- |
| 版本 X 工作台 / 手机版 / 设计系统 | `/app/index.html`、`/m/index.html`、`/design-system.html` |
| 版本 Y 工作台（按角色） | `/y/app/index.html?as=ceo`、`?as=hrbp`、`?as=mentor` |
| 版本 Y 导师手机版 / 设计系统 | `/y/m/index.html`、`/y/design-system.html` |

无需安装前端依赖或执行构建。演示操作只存在浏览器本地，可以在导览页或「更多 → 重置演示数据」清空。

### 评审站

[评审站](review-site/README.md)把 `prototype/` 原样发布给 `@qiniu.com` 邮箱登录查看，并在每页挂上划线评论。线上地址：<https://qtalent-review.aidoudoulong123.workers.dev/>（版本 Y 从导览页右栏进入）。它只服务原型评审，不代表正式工程的架构选型。

## 文档入口

- [最新需求基线：需求定稿 v1.6](docs/requirements/需求定稿-v1.6.md)，未提及的部分沿用前序版本，权威顺序见 AGENTS.md
- [版本 Y 需求：需求定稿 · 版本 Y](docs/requirements/需求定稿-版本Y.md)，从 v1.6 衍生，随版本 Y 的设计系统和原型同步更新
- [Agent 共同入口与阶段约束](AGENTS.md)
- [工程、UI 与验证规范](docs/engineering.md)
- [界面文案规范](docs/ui-copy.md)
- [Issue、Proposal、Commit 与 PR 协作规范](CONTRIBUTING.md)

## 仓库与本地资料

远端为私有仓库 [bowenQT/QTalent](https://github.com/bowenQT/QTalent)，默认分支 `main`；后续改动通过任务分支和 PR 协作。实际设置与平台限制见 [远端配置与复核](CONTRIBUTING.md#远端配置与复核)。

`docs/sources/` 原始材料和 `docs/design-refs/` 设计参考资料仅在本地保留，已忽略，不随 clone 分发。文档中的来源路径仅用于回查；这些资料不影响已提交原型和设计系统的加载。

首次推送保留了 8 条既有提交的顺序、作者、时间与说明，并在推送前从全部历史移除了设计参考截图，因此提交哈希与建仓前不同。原始历史已在仓库外本地备份；后续以远端 `main` 为准，不合并或推送包含旧参考资料的历史分支。

## 正式工程（BOW-830，Draft）

本卡只覆盖登录 → 外壳 → 项目与课题，工程基础仍在验收，不代表正式开发门禁已经通过。原型和评审站仍是独立目录，原型只读。

### 本地启动

Node.js 24 LTS、pnpm 11.25.0，使用独立 PostgreSQL 17。本项目不带生产凭据。先按 [环境变量清单](deploy/README.md) 在进程环境中提供 `APP_ENV=local`、`DATABASE_URL`、`BETTER_AUTH_URL`、`BETTER_AUTH_SECRET`、`DEMO_PASSWORD`、`ACCESS_ENFORCED=false`。demo/production 必须配置 Access，禁止旁路。

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm reference:prepare
pnpm db:migrate
pnpm db:seed
pnpm dev
```

开发同时启动 Next 和 worker；也可分别执行 `pnpm dev:web` / `pnpm dev:worker`。Web 默认 `http://127.0.0.1:3000`，worker 在本机 3001 提供经会话鉴权的 `/stream` 心跳。四个演示账号邮箱与导入方式见种子模块，密码仅从 DEMO_PASSWORD 读取，注册关闭。

### 命令

| 命令 | 作用 |
| --- | --- |
| pnpm build / pnpm start | 构建 / 启动 Web，不迁移数据库 |
| pnpm start:worker | 启动常驻 pg-boss 与 WebSocket 骨架 |
| pnpm format:check / pnpm lint | 格式 / ESLint 与引入边界 |
| pnpm typecheck | TypeScript 严格检查 |
| pnpm test | 无数据库的单元测试 |
| pnpm test:integration | 单元与真实本地 PostgreSQL 集成测试 |
| pnpm test:coverage | 统一统计单元+集成，行/分支各 ≥85% |
| pnpm test:e2e | 四账号、权限、新建与重复提交等浏览器流程 |
| pnpm test:visual | 当次固定原型与工程截图比较，数据先一致再比较 |
| pnpm db:generate | Drizzle 生成 SQL 与元数据 |
| pnpm db:migrate / pnpm db:seed | 显式迁移 / 校验后幂等导入演示数据 |
| pnpm check | 格式、lint、类型、统一覆盖率、构建 |

集成及浏览器检查要求 `TEST_DATABASE_URL` 指向 loopback 且数据库名以 `_test` 结尾，账号需能创建/删除本次测试生成的随机数据库，禁止生产数据库。首次浏览器测试先 `pnpm exec playwright install chromium`。`pnpm test` 成功不能替代集成、覆盖率、浏览器或视觉验收。

- [工程规范与共享文件责任](docs/engineering.md)
- [原型路由、模块与视觉遮罩](docs/reference-route-map.md)
- [环境变量与部署样例](deploy/README.md)
- [BOW-830 原规格](docs/research/2026-10-25-y-architecture-alignment/engineering-foundation-prompt.md)

固定原型通过 `pnpm reference:prepare` 从唯一配置提交的 Git blob 生成 `.reference-cache`，种子和截图均读取该缓存；后续工作树原型改动不影响冻结基线。源码导出环境没有 Git 历史时，只有已逐文件核对摘要的快照可以显式执行 `pnpm reference:prepare --verified-snapshot`；不会静默退回工作树。缓存不提交。

- [切片权限用例表](docs/foundation-permissions.md)
- [本次实际验证与未验证边界](docs/evidence/foundation/README.md)
