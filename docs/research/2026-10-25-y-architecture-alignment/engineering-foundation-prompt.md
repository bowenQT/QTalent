# 任务：建立 Niu-Talent 正式工程基础（第 3 阶段）

你负责在本仓库根目录建立 Niu-Talent 的正式工程基础，并交付一条「参考切片」作为后续并行开发的样板。工程基础合入后，开发任务会拆成前端、后端、集成等类型的 Linear 任务卡，由多个 agent 同时认领，所以**目录边界、契约和检查必须让并行开发互不踩踏**。

## 0. 先读这些

- `AGENTS.md`（产品不变量、数据与隐私、当前阶段）、`CONTRIBUTING.md`（分支、提交、PR、Linear 任务卡）、`docs/engineering.md`（职责、契约、依赖、测试与 85% 覆盖率基线、检查门槛）、`docs/ui-copy.md`（界面文案）。
- `docs/proposals/2026-10-25-y-architecture-phases.md`：第 2 节决定 U-1～U-21，3.2 权限预设与授权口径，4.2 七个业务领域，4.3 北森与系统管理，4.7 工程目录与分工，6.2 八条合同，6.5 演示环境。
- `docs/requirements/需求定稿-版本Y.md`（Y-1.1）及其沿用的 v1.6、v1.5 等需求；项目的增删改查规则在 `需求定稿-v1.2.md` 3.5.3 与 3.6.3。
- 原型 Y：`prototype/y/`（桌面 `app/`、手机 `m/`、设计系统 `design-system.html`、`assets/niu-tokens.css`、`assets/niu-components.css`、`app/app.css`、`m/m.css`、`assets/niu-ip.js`；数据 `app/js/data-xe6.js`、`app/js/data.js`；规则与权限 `app/js/store.js`；外壳 `app/js/shell.js`；演示时钟 `app/js/core.js` 的 `NT.TODAY = '2026-09-04'`）。
- v21 架构提案与第三方 API 预研（只在 Codex 研究工作区）：`~/.codex/worktrees/qtalent-architecture-research/QTalent/docs/proposals/2026-10-23-application-architecture.md`（§2～§6、§8）、同目录 `../research/2026-10-23-third-party-api-research.md`。

## 1. 已确认的决定（不要重新讨论）

- **U-18**：工程放在仓库根目录，是第 3 阶段正式工程的起点，按正式工程标准交付（类型、检查、测试与覆盖率、文档）。比赛范围先交付，赛后在同一工程上继续。`prototype/` 与 `review-site/` 原样保留。
- **U-19**：UI/UX 以 `main` 提交 `2e51b50` 中的原型 Y（桌面与手机）和 Y 设计系统页为定稿基线，工程界面 **1:1 还原**。之后的设计变化先改原型并评审，再由同步任务带进工程。
- **U-20**：本任务只交付「底座 + 一条参考切片」（见第 4、6 节），其他页面与链路由后续任务卡完成。
- **界面与授权的依据不同**：界面、交互和文案以原型为准；授权以提案 3.2、合同 6.2 第 3 条和需求为准。原型 `store.js` 按角色名直接放行、HR 范围按单一 `hrbp` 字段判断、导师对所有带批次的课题放行，这些是原型的简化，**不照搬**（提案 3.2 末段）。切片涉及的规则在第 6 节写明。
- 技术栈（AGENTS.md 已确认）：Next.js App Router + TypeScript + Tailwind CSS + shadcn/ui + Motion；Node.js 24 LTS；pnpm 单 package，不建 monorepo；PostgreSQL + Drizzle；pg-boss 持久任务；Better Auth（关闭公开注册）；七牛 Kodo 私有空间；Web 与常驻 Node 进程同一份代码、分别启动。各依赖取初始化当天的稳定版本，核对兼容性后锁定，并在 PR 写明版本。
- 演示环境（只写部署材料，不执行部署）：DigitalOcean 新加坡 VPS 运行 Web 与常驻进程，经 Cloudflare 命名隧道对外、Access 只放 `@qiniu.com`，应用校验 Access 令牌；数据库用 Supabase。本地开发与测试用独立 PostgreSQL，不连 Supabase。

## 2. 目录与命名

按下面的结构建立。名称是并行开发的分工依据，不要换成别的叫法；确有更好的理由可以调整，但要在 PR 里写明原因和对分工的影响。**只建本任务实际用到的目录和文件，不预建空模块**（`docs/engineering.md`）；下面标「后续」的只写进文档里的目录说明，不创建。

```text
src/
  app/                          Next.js 路由：只做路由、布局、调用 server 入口、组装 features 组件
    (auth)/login/               登录页（原型没有，按设计系统组件做最简版）
    (desk)/                     桌面端：layout 是侧栏 + 顶栏外壳
      projects/                 参考切片：项目与课题
    m/                          导师手机端（后续）
    dev/design-system/          开发环境才有的组件样张，对照 prototype/y/design-system.html
    api/                        Route Handlers：Better Auth、健康检查等协议适配
  features/                     前端：按页面区域组织的界面组件与客户端状态
    shell/                      侧栏、顶栏、账号菜单、⌘K 外壳
    projects/                   参考切片
  components/
    ui/                         设计系统基础组件（对应 niu-components 的按钮、徽标、卡片、页签、弹层、表单、空状态等）
    brand/                      小犇 IP 动效（移植 niu-ip.js，响应 prefers-reduced-motion）
  styles/
    tokens.css                  原样移植 prototype/y/assets/niu-tokens.css
    components.css              原样移植 niu-components.css；desk.css、mobile.css 对应 app.css、m.css
    globals.css                 引入以上文件；Tailwind 主题把设计变量映射成工具类，不另定一套颜色
  contracts/                    前后端契约：每个页面区域的读取结果与动作输入（zod schema + 推导出的类型）
    shell.ts                    外壳：当前账号、导航入口、角标与最近访问
    projects.ts
  lib/                          前后端都能用、和框架无关的小工具：演示时钟、日期与格式化、id
  server/                       只在服务端运行
    env.ts                      环境变量校验，启动时失败即退出
    auth/                       Better Auth 实例与会话校验（不依赖 Next，worker 也用）；next.ts 是 Next 适配（Route Handler、按请求读会话）
    authz/                      当前授权：账号 × 动作 × 范围 × 用途；范围解析与人员 / 证据过滤
    modules/                    七个业务领域，每个只写自己的表（本任务只建切片用到的）
      directory/                人员、组织、任职、账号绑定、角色预设、范围授权（含「HR 负责哪些期次」）
      programs/                 只建授权需要的最小部分：期次、学员名单、导师与助教分配，均带有效期
      staffing/                 项目与课题、成员与成员日志（参考切片）
      records/ talent/ engagement/ evaluation-system/   （后续）
    usecases/                   跨领域命令与事务编排（后续按需）
    queries/                    按用途授权的页面读取，返回 contracts 里的类型
      shell.ts
      projects.ts
    actions/                    Server Actions 入口：按契约校验输入 → 取会话 → 授权 → 调领域或用例 → 映射错误
      projects.ts
    platform/
      audit/                    审计写入（授权变更、敏感读取、导出、配置变更；本任务接入新建项目与登录）
    integrations/               外部服务适配器：每个服务一个目录，含接口、真实客户端、测试用假实现
      maas/ jev/ tingwu/ kodo/  （本任务只建接口、配置校验和假实现；北森 beisen/ 为后续）
    jobs/                       pg-boss 任务定义（本任务只有一个示例任务）
    db/
      client.ts
      migrations/               drizzle-kit 生成，SQL 与元数据一起提交
      seed/                     从原型演示数据导入（见第 5 节）
  worker/
    index.ts                    常驻进程入口：启动 pg-boss，开录音 WebSocket 端口（本任务只做骨架）
tests/
  e2e/                          Playwright 流程与权限测试
  visual/                       原型与工程的截图对比（见第 7 节）
  fixtures/
deploy/                         systemd 单元、cloudflared 配置示例、环境变量清单；不含真实值
```

- 文件与目录名用 kebab-case，React 组件文件用 PascalCase；领域代码名与提案 4.2 对应（`evaluation-system` 即提案的 evaluation_system）。
- 每个领域目录有一个 `index.ts` 作为对外入口，Drizzle 表定义放在该领域的 `schema.ts`（审计、认证同理）；drizzle 配置用通配收集各 `schema.ts`，不建人人都要改的汇总 schema 文件。领域内部文件按需要组织，不预建 controller / service / repository 三层。
- shadcn/ui 通过 `components.json` 的别名把组件放进 `src/components/ui/`；生成后按第 4 节重做外观。
- 单元测试与源码放在一起（`*.test.ts`），跨页面流程和截图对比放 `tests/`。

## 3. 边界规则（用 ESLint 或依赖检查工具自动拦截，CI 必跑）

1. `src/app/`、`src/features/`、`src/components/` 读取数据只经 `server/queries/*`；客户端只能调用 `server/actions/*` 里带 `'use server'` 的动作；此外只能引入 `src/contracts/`、`src/lib/`。唯一例外：`src/app/api/auth/` 的 Route Handler 引入 `server/auth/next.ts`。`modules`、`db`、`integrations`、`authz` 和 `auth` 的其余文件一律不能直接引入。
2. `src/components/ui/` 不依赖 `features/`、`server/`、`contracts/`。
3. 领域之间只能经对方的 `index.ts` 调用，不能读写另一个领域的表或内部文件；跨领域的写入放在 `usecases/` 的一个数据库事务里。
4. 送给外部模型的内容只能在服务端、按当前授权过滤后构造；`integrations/` 不读数据库、不做授权判断。
5. `src/worker/` 和 `src/app/` 共用 `src/server/`，互不引入。领域、授权、认证核心与数据库代码不依赖 Next 的请求上下文，也不引入 `server-only`；`server-only` 只加在 `queries/`、`actions/` 和 `auth/next.ts` 这些 Next 入口上，客户端禁入由本节的依赖检查保证。worker、测试和迁移 / 导入脚本三种独立入口都要实跑通过。
6. 返回给客户端的对象只含调用者可见、页面需要的字段（AGENTS.md：权限由服务端判断）。

## 4. 底座要交付的内容

1. **工具链与检查**：pnpm、锁文件、`engines`；TypeScript 严格模式；ESLint（含第 3 节边界规则）与格式化；Vitest（单元与带真实 PostgreSQL 的集成测试，逻辑代码行与分支覆盖率各不低于 85%，排除规则按 `docs/engineering.md`）；Playwright（e2e 与截图对比）。提供并在 README 记录：开发（Web 与 worker 一起起）、构建、启动、代码检查、类型检查、单元测试、e2e、截图对比、数据库迁移与导入演示数据。GitHub Actions 复用同一批脚本，必要检查失败即失败。
2. **设计系统移植**：设计变量与组件样式按第 2 节原样移植，确保 Tailwind 的基础重置不改变原型的渲染（必要时关闭 Preflight 或调整引入顺序）；shadcn/ui 只用其交互行为（对话框、菜单、页签、弹层、命令面板等），外观用移植来的样式，不保留默认外观；组件输出的 DOM 结构与类名要让移植来的样式原样生效，弹层、焦点、禁用、错误等状态与原型一致。React 化参考切片和外壳用到的基础组件；其余组件列入文档，留给后续任务卡。`/dev/design-system` 展示已 React 化的组件，生产环境不可访问。
3. **数据**：切片需要的表及迁移——directory 的人员、组织、账号绑定、角色预设与范围授权；programs 的期次、学员名单、导师与助教分配；staffing 的项目、成员、成员日志；审计；Better Auth 自身的表。授权关系和名单都带起止时间。种子数据导入见第 5 节。
4. **登录与权限核心**：Better Auth 邮箱密码登录，关闭注册；预置四个演示账号，对应原型的管理者（程远）、HR（苏晚）、导师（叶青）、系统管理员（许衡），邮箱用保留域名（如 `*.test`），密码只从环境变量读取。授权核心按「账号 × 动作 × 范围 × 用途」判断，实现提案 3.2 的预设与 U-11 授权口径中切片用到的部分（有效期、多重身份取各自完整授权的并集）；系统管理员不持有业务预设，看不到任何人才数据（需求 Y-1.1 的 DY-13、DY-14、AC-Y11）。顶栏原型的「演示视角」切换换成账号菜单（显示当前账号与角色、退出、切换账号即回到登录页），视觉沿用原型的样式。
5. **常驻进程骨架**：`src/worker/index.ts` 启动 pg-boss 并跑通一个示例任务；开一个 WebSocket 端点，只做握手鉴权（会话与 Access 令牌）和心跳，不做录音逻辑。
6. **外部服务适配器**：MaaS、Jev、听悟、Kodo 各定义接口、配置校验和测试用假实现；测试与构建不得触发真实外部调用或付费请求。真实客户端留给后续集成任务。
7. **部署材料**：`deploy/` 下的 systemd 单元、cloudflared 命名隧道配置示例（`/stream` 转常驻进程，其余转 Next.js）、Access 令牌校验说明、环境变量清单（名称、用途、是否必填）。不执行部署，不写真实值。
8. **给并行开发用的文档与样例**（后续拆 Linear 任务卡直接引用，按 AGENTS.md 的维护方式写进 README 与 `docs/engineering.md`，同步需要更新的引用）：
   - 根目录 README：运行与检查命令。
   - `docs/engineering.md` 补「目录职责与引入边界」「契约与错误语义」「迁移规则」「并行开发约定」。错误语义统一动作结果：校验失败（带字段错误、保留输入）、无权限、未找到、冲突（版本对不上）、重复提交（返回原结果），前后端按同一套类型处理。
   - 迁移规则：表结构只在后端任务里改；迁移文件不手改，合并前变基到最新 `main` 后重新生成，SQL 与 drizzle 元数据一起提交；带迁移的 PR 一次只合一个，冲突时删掉本分支生成的迁移再生成。
   - 并行开发约定：每张卡写明可改的目录与文件；契约先合入，读取、动作与界面再并行；共用文件（导航配置、样式入口、Tailwind 与 drizzle 配置、依赖与锁文件、CI）列出清单，改动集中在单独的卡里，由一个任务协调（`docs/engineering.md` 协作一节）。
   - **路由与模块映射表**：原型每一页 → 工程路由 → `features/` 目录 → `contracts/` 文件 → 读取与动作入口 → 涉及的领域 → 当前状态 → 截图对比里暂时遮罩的区域及原因。
   - **权限用例表**：切片涉及的每个动作 × 四个账号的预期结果，作为后续页面写权限测试的样板。

## 5. 种子数据与演示时钟

- 演示数据只有一个来源：`prototype/y/app/js/data-xe6.js` 与 `data.js`，取第 7 节记录的基线提交中的版本。导入脚本在 Node 隔离环境中按原型的加载顺序执行这两个文件：只提供 `window.NT` 和与 `core.js` 同语义的 `NT.clone`（`data.js` 依赖它），只读、不改原型文件。执行后先做结构、唯一键和引用完整性校验，再把「原始种子」映射成数据库记录；数据库种子和测试夹具都从这里生成，不手工维护第二份数据。原型里由 `store.js` 推导的内容（参考位置、变化、档案版本等）不写进种子，由后续领域逻辑计算。
- 原型的数据结构映射到正式模型时写明对应关系，例如：项目的 `batch: 'b-xe6'`、`org: 'xe6'` 或第六期下的课题组组织，都表示归属 XEngineer 第六期这一期次，其中带 `batch` 的是该期次的课题；课题成员里的「导师」「助教」是期次里的导师与助教分配；HR 负责第六期是 directory 里的范围授权。期次的导师分配与 HR 授权的有效期覆盖演示日期（原型在 2026-09-04 结营盘点期间，HR 和导师仍在工作），不取课题成员记录的退出日期。
- 导入可重复执行、结果确定；只用于本地、测试和演示环境。
- 演示时钟：提供一个时钟入口，演示与测试环境固定为 `2026-09-04`（与原型一致），其他环境用真实时间；所有「近 N 天」和有效期判断都经这个入口。
- 只导入原型已有的演示数据，不新增人员材料；演示人员保持化名并标「演示」，不引用 `docs/sources/` 的任何内容（AGENTS.md）。测试里需要的额外数据（如第二个期次）用明显的测试编号构造，不进演示种子。

## 6. 参考切片：登录 → 外壳 → 项目与课题

对应原型 `prototype/y/app/projects.html` 与 `js/pages/projects.js`，桌面端：

1. **外壳**：登录后进入桌面外壳，侧栏、顶栏、分组与按角色过滤 1:1 还原（原型 `shell.js` 的 NAV 与 `allow`）。外壳数据经 `contracts/shell.ts` 与 `queries/shell.ts`；导航按授权核心的动作过滤。依赖未实现领域的内容——工作台待办数、盘点草稿数、最近访问——在契约里返回「未接入」，界面不渲染这些角标与条目，不写成 0；截图对比对这些区域遮罩，并登记在映射表里，由接入对应数据的任务卡取消遮罩。「我的判断对照」按需求在做过评价时出现，评价数据接入前先按导师预设显示，同样登记在映射表。侧栏和页面里指向尚未实现页面的入口、按钮与链接（含「为项目找人」「发起找 owner」、项目详情）照常显示，链接到对应路由；未实现的路由返回统一的 404，不做占位页。
2. **「项目与课题」列表**：读取经 `server/queries/projects.ts`。可见范围（需求 v1.2 3.5.3、3.6.3，提案 3.2）：
   - 管理者：全部项目。
   - HR：所负责期次下的项目，成员里有其范围内学员的项目，本人创建、担任 owner 或参与的项目。
   - 导师：所带期次的课题（在该期次有有效的导师或助教分配），本人参与的项目。
   - 系统管理员：整页拦下，标题与面包屑不含项目名（AC-Y11）。
   用演示数据算出每个账号的可见项目清单，与原型对应视角 `store.search('')` 的结果逐条核对并写进测试；不一致时停下来报告差异和建议，不自行取舍。状态筛选、卡片内容、空状态、owner 待定样式 1:1 还原。
3. **「新建项目」弹窗**：按原型只对管理者和 HR 显示。字段、校验、成员多选与原型一致；owner 与成员的可选人员是调用者范围内可看完整资料的人（原型 `visiblePeople` 中 `scope === 'full'` 的部分），服务端按同一规则重新校验，范围外或伪造的人员 ID 拒绝。原型把新项目的所属组织固定为第六期、结束日期固定为 `2026-12-31`，工程沿用这两个默认值、由服务端填写，不新增界面字段，并在映射表登记为待需求确认。提交经 `server/actions/projects.ts`，在一个事务里写项目、owner 与成员、成员日志和审计记录；同一次提交重放只生效一次（提案 6.2 第 7 条）。原型创建后跳到项目详情页；详情页不在本任务范围，创建后先回到列表并提示，这处差异写进 PR 和映射表。
4. **测试**：授权与查询的单元 / 集成测试，覆盖跨期次（测试里另建第二个期次）、授权到期或撤销后不可见、多重身份取并集、伪造 owner / 成员 ID；e2e 覆盖四个账号的可见范围、新建项目、重复提交、系统管理员被拦；截图对比见下一节。

## 7. 1:1 还原的验收方式

- `tests/visual/` 用 Playwright 在同一次运行、同一浏览器、同一视口（桌面 1366×900，手机页另用 375×812）下，分别打开原型页面和工程页面截图比较；两侧都在当次渲染，不保存与平台相关的基线图。阈值写在配置里，超出即失败。
- 前置条件，缺一不比：
  - 原型页面和种子数据取自同一个固定的基线提交（当前 `2e51b50`，配置里只记一处）；设计同步任务在同一个 PR 里更新基线提交和工程，原型的后续改动不会让工程的检查失败。
  - 每个用例使用全新的浏览器上下文（原型的 localStorage 为空）和独立导入的数据库；原型显式带 `?as=` 视角，工程用对应账号登录；演示日期一致。
  - 等待字体就绪，固定动画、光标与随机内容；比较前先断言两侧的数据一致（如项目名称与顺序），数据不一致直接报数据错误，不进入截图比较。
  - 比较区域写明：原型的「演示视角」与工程的账号菜单所在区域、第 6 节登记的未接入区域，两侧都用同一组选择器遮罩。
- 本任务至少覆盖：外壳 + 项目与课题列表（管理者、HR、导师三个视角）、新建项目弹窗、`/dev/design-system` 中已移植组件与原型设计系统页对应部分。
- 原型没有的界面（登录页、账号菜单）不做截图对比，在 PR 里列出。

## 8. 不做

本切片以外的业务页面与链路；真实外部服务调用；北森同步；AgentAPI Native；真实部署；修改 `prototype/` 与 `review-site/`；为未来需求预建空目录、通用框架或抽象层。

## 9. 交付方式

- 从最新 `main` 建分支 `codex/engineering-foundation`，按 `CONTRIBUTING.md` 提交，建 Draft PR，正文按模板写依据、实际验证（命令、结果、受检提交 SHA）、未验证项、风险与恢复。不添加 AI 署名。
- 遇到以下情况先停下来说明并给出推荐，不自行改向：确认的技术栈中某项无法满足需求或版本冲突；1:1 还原与 Tailwind / shadcn 的做法冲突且无法兼顾；授权规则在需求与提案里有歧义，或按第 6 节规则算出的可见清单与原型不一致；需要新增本文没列的依赖类别或外部服务。
- 完成时在 PR 里给出：实际目录树、命令清单、截图对比结果与遮罩清单、路由与模块映射表和权限用例表的链接、留给后续任务的已知缺口。
