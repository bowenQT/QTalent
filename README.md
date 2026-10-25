# Niu-Talent

七牛云内部的人才识别、追踪与盘点工作台。导师和 HR 随手记下的事、上传的材料和录音，经 AI 整理成可追溯的证据；管理者据此找人、盘点、调整组织。AI 只给建议，正式结论由有权限的人确认。

| | |
| --- | --- |
| 参赛议题 | <!-- 待补：赛组与议题名称 -->待补 |
| Demo 视频 | <!-- 待补：视频链接 -->待补 |
| 演示环境 | <!-- 待补：演示地址与访问方式 -->待补 |
| 原型评审站 | <https://qtalent-review.aidoudoulong123.workers.dev/>（`@qiniu.com` 邮箱登录） |
| 架构设计 | [docs/architecture.md](docs/architecture.md) |

## 解决什么问题

公司做人才判断时，依据散落在会议、周报、导师印象里，结论常常回答不了「凭什么」。Niu-Talent 把每一条判断都钉在来源上：

- **重点跟踪**：导师说一句话、传一份附件或录一段复盘，AI 整理成情境、行为、结果（SBI）并给出 1–5 的建议分；评价人确认后才进档案，分差大的自动交 HR 复核。
- **项目找人**：管理者写下项目对人的要求，系统逐条对照已确认的证据，只给「支持 / 不支持 / 资料不足 / 证据冲突」四种状态，每条都能点回原文、表格单元格或录音时间点。
- **人才盘点**：按专业度 × 潜力的 2×2 象限给参考位置，HR 校准后冻结快照，形成留用与落位方案。

产品刻意不做综合总分、排名、能力百分比和雷达图；「资料不足」不会被当作反向证据。完整规则见 [AGENTS.md 的产品不变量](AGENTS.md#产品不变量)。

## 交付内容与实现状态

仓库里有两部分，演示时会分开说明：

| 部分 | 位置 | 说明 |
| --- | --- | --- |
| 高保真原型 Y | `prototype/y/` | 管理者、HR、导师三种角色的完整体验，含导师手机版；AI 行为用预置结果按真实节奏流式输出 |
| 正式工程 | `src/` 等 | 真实数据库、服务端权限、真实 AI 与语音服务；界面 1:1 还原原型 Y，逐条链路接入 |

正式工程六条链路的进度（截至 `main` `37f987d`，逐项明细见 [架构设计第 12 节](docs/architecture.md#12-实现状态)）：

| 链路 | 工程已合入 | 评审中 |
| --- | --- | --- |
| P0 骨架：登录、服务端权限、演示数据、工作台与档案 | 登录、外壳、项目与课题页；授权核心；证据模型与演示数据导入；P0 契约；任务进度；设计系统组件 | 外壳路由、工作台读取、人才读取、引用角标 |
| P1 记一件事 | MaaS 结构化客户端 | 契约、SBI 整理、确认改分 |
| P2 找人 | Jev 判断客户端 | 契约、需求卡、逐条四态 |
| P3 离线转写 | Kodo 私有存储与续传 | 上传契约与原件代理；听悟离线未开始 |
| P5 实时推流 | 听悟实时预览适配器 | 浏览器推流未开始 |
| P4 文本附件 | — | 附件解析 |

判断对照、节点复盘、人才评价规则修订、盘点冻结、值得关注这几块本次只在原型里演示。

## 快速开始

### 查看原型（无需安装）

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory prototype
```

打开 <http://127.0.0.1:4173/> 进入评审导览。版本 Y 的常用入口：

| 页面 | 地址 |
| --- | --- |
| 管理者 / HR / 导师工作台 | `/y/app/index.html?as=ceo`、`?as=hrbp`、`?as=mentor` |
| 导师手机版 | `/y/m/index.html` |
| 设计系统 | `/y/design-system.html` |

演示操作只保存在浏览器本地，可在导览页或「更多 → 重置演示数据」清空。演示人员都是化名并标「演示」。

### 运行正式工程

需要 Node.js 24 LTS、pnpm 11 和一个独立的 PostgreSQL 17。

1. 启动数据库（以 Docker 为例）：

   ```sh
   docker run -d --name qtalent-pg -p 5432:5432 -e POSTGRES_USER=qtalent -e POSTGRES_PASSWORD=qtalent-local -e POSTGRES_DB=qtalent postgres:17
   ```

2. 在当前终端设置环境变量。命令行脚本不读取 `.env` 文件，变量要放在进程环境里：

   ```sh
   export APP_ENV=local
   export DATABASE_URL=postgres://qtalent:qtalent-local@127.0.0.1:5432/qtalent
   export BETTER_AUTH_URL=http://127.0.0.1:3000
   export BETTER_AUTH_SECRET="$(openssl rand -base64 32)"
   export DEMO_PASSWORD=change-me-demo-password
   export ACCESS_ENFORCED=false
   ```

3. 安装依赖、准备原型基线、迁移并导入演示数据，然后启动：

   ```sh
   pnpm install --frozen-lockfile --ignore-scripts
   pnpm reference:prepare
   pnpm db:migrate
   pnpm db:seed
   pnpm dev
   ```

4. 打开 <http://127.0.0.1:3000>，用演示账号登录，密码是上面的 `DEMO_PASSWORD`：

   | 账号 | 角色 | 范围 |
   | --- | --- | --- |
   | `ceo@qtalent.test` | 管理者 | 全公司 |
   | `hrbp@qtalent.test` | HR | XEngineer 第六期 |
   | `mentor@qtalent.test` | 导师 | 所带学员 |
   | `admin@qtalent.test` | 系统管理员 | 只管配置，看不到人才数据 |

`pnpm reference:prepare` 从 Git 历史里的固定提交生成原型基线缓存，演示数据和截图比较都读这份缓存。如果源码来自不带 Git 历史的压缩包，要先逐文件核对摘要，再执行 `pnpm reference:prepare --verified-snapshot`。

`pnpm dev` 同时启动 Web（3000）和 Worker（3001，录音 WebSocket 与持久任务），也可以分别用 `pnpm dev:web`、`pnpm dev:worker` 启动。

**外部服务**：以上步骤不需要任何外部凭据，目前已合入的页面也不调用外部服务。七牛 MaaS、Jev、Kodo、通义听悟的适配器只在服务端显式创建，自动测试使用测试替身；接入真实服务时，所需环境变量见各适配器的 README（`src/server/integrations/*/README.md`），部署相关变量见 [deploy/README.md](deploy/README.md)。

### 常用命令

| 命令 | 作用 |
| --- | --- |
| `pnpm check` | 一次跑完格式、lint 与引入边界、类型、覆盖率（行与分支各 ≥ 85%）、构建 |
| `pnpm test` | 单元测试，不需要数据库 |
| `pnpm test:integration` / `pnpm test:coverage` | 单元 + 真实 PostgreSQL 集成测试 / 统一统计覆盖率 |
| `pnpm test:e2e` | 四个账号的登录、权限、新建与重复提交等浏览器流程 |
| `pnpm test:visual` | 固定原型基线与工程页面的截图比较 |
| `pnpm db:generate` | 根据 Drizzle schema 生成迁移 |
| `pnpm build` / `pnpm start` / `pnpm start:worker` | 生产构建与启动（启动时不自动迁移） |

集成、浏览器和视觉测试需要 `TEST_DATABASE_URL` 指向本机、数据库名以 `_test` 结尾，测试会自行创建和删除随机数据库；首次运行浏览器测试前执行 `pnpm exec playwright install chromium`。

## 技术栈

Next.js 16（App Router）· React 19 · TypeScript · Tailwind CSS 4 · Radix · Motion · PostgreSQL 17 · Drizzle ORM · pg-boss · Better Auth · Zod · Vitest · Playwright。外部服务：七牛 MaaS（DeepSeek V4.1 Flash）、Jev、七牛 Kodo、通义听悟。

系统组成、模块规格、权限模型和部署方式见 [架构设计](docs/architecture.md)。

## 团队与分工

<!-- 待补：成员与职责，与 docs/architecture.md 第 13 节保持一致 -->

| 成员 | 职责 |
| --- | --- |
| bowenQT | 待补 |
| Joanrecruiting | 待补 |
| yiyih7077-cell | 待补 |

团队使用 Codex、Cursor、Claude Code 等编码 Agent 在各自的分支上并行实现 Linear 任务卡，成员负责拆卡、审查与合并。协作方式见 [架构设计第 13 节](docs/architecture.md#13-分工)。

## 开发过程

- 本项目从零开发，没有引入既有 codebase。
- 需求、设计和架构决策都留在仓库里：[需求定稿](docs/requirements/)、[架构分期提案](docs/proposals/2026-10-25-y-architecture-phases.md)、[调研与审查记录](docs/research/)。
- 远端仓库建立后，每一次变更都通过 Pull Request 合入 `main`，经 CI（格式、lint、类型、覆盖率、构建、浏览器流程、视觉比较）和审查；建仓时一并推送的 9 条初始提交保留了原来的顺序、作者和时间。

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [架构设计](docs/architecture.md) | 系统组成、模块规格、数据流、权限、部署、实现状态、分工 |
| [需求定稿 · 版本 Y](docs/requirements/需求定稿-版本Y.md) | 版本 Y 的需求，未提及部分沿用 [需求定稿 v1.6](docs/requirements/需求定稿-v1.6.md) |
| [架构分期提案](docs/proposals/2026-10-25-y-architecture-phases.md) | 长期 / 中期 / 本次比赛的规划与决策记录 |
| [工程规范](docs/engineering.md) | 职责划分、契约、测试与覆盖率、UI 还原与验证 |
| [界面文案规范](docs/ui-copy.md) | 面向用户的文案写法 |
| [协作规范](CONTRIBUTING.md) | Issue、Proposal、Commit 与 PR |
| [AGENTS.md](AGENTS.md) | 编码 Agent 的共同入口、阶段约束与产品不变量 |
| [评审站](review-site/README.md) | 原型发布与划线评论，只服务评审 |

## 数据与隐私

演示数据全部是化名并标「演示」。`docs/sources/` 的原始材料和 `docs/design-refs/` 的设计参考只在本地保留，不随仓库分发。仓库不包含任何密钥或生产凭据。
