# Niu-Talent

七牛云内部的人才识别、追踪与盘点工作台。导师和 HR 随手记下的事、上传的材料和录音，经 AI 整理成可追溯的证据；管理者据此找人、盘点、调整组织。AI 只给建议，正式结论由有权限的人确认。

| | |
| --- | --- |
| 参赛议题 | 自选题目：AI 原生的人才识别、追踪与盘点工作台 |
| 交付形态 | 高保真可交互产品原型（桌面 + 导师手机版），浏览器直接打开 |
| 在线原型 | <https://qtalent-review.aidoudoulong123.workers.dev/>（`@qiniu.com` 邮箱登录，每页可划线评论） |
| Demo 视频 | <!-- 待补：视频链接 -->待补 |
| 架构设计 | [docs/architecture.md](docs/architecture.md) |

## 解决什么问题

公司做人才判断时，依据散落在会议、周报、导师印象里，结论常常回答不了「凭什么」。Niu-Talent 把每一条判断都钉在来源上：

- **重点跟踪**：导师说一句话、传一份附件或录一段复盘，AI 整理成情境、行为、结果（SBI）并给出 1–5 的建议分；评价人确认后才进档案，分差大的自动交 HR 复核。
- **项目找人**：管理者写下项目对人的要求，系统逐条对照已确认的证据，只给「支持 / 不支持 / 资料不足 / 证据冲突」四种状态，每条都能点回原文、表格单元格或录音时间点。
- **人才盘点**：按专业度 × 潜力的 2×2 象限给参考位置，HR 校准后冻结快照，形成留用与落位方案。

产品刻意不做综合总分、排名、能力百分比和雷达图；「资料不足」不会被当作反向证据；AI 的建议和人的结论分开呈现。完整规则见 [AGENTS.md 的产品不变量](AGENTS.md#产品不变量)。

## 体验原型

原型放在 `prototype/y/`，演示数据是化名的 XEngineer 第六期（93 名学员、398 条事件），所有人员都标「演示」。下文链接都指向在线原型；本地运行时把域名换成 `http://127.0.0.1:4173/` 即可（见 [本地运行](#本地运行原型)）。

### 按角色进入

| 角色 | 入口 | 这个角色关心什么 |
| --- | --- | --- |
| 程远 · 管理者 | [桌面工作台](https://qtalent-review.aidoudoulong123.workers.dev/y/app/index.html?as=ceo) | 公司层：看值得关注的人、为项目找 owner、确认评价规则与方案 |
| 苏晚 · HR | [桌面工作台](https://qtalent-review.aidoudoulong123.workers.dev/y/app/index.html?as=hrbp) | 负责的人才项目：整理档案、评分复核、盘点校准、留用与落位 |
| 叶青 · 导师 | [桌面工作台](https://qtalent-review.aidoudoulong123.workers.dev/y/app/index.html?as=mentor) | 所带学员：记录、确认本人评分、对人复盘、推荐发展方向 |
| 叶青 · 导师手机版 | [手机首页](https://qtalent-review.aidoudoulong123.workers.dev/y/m/index.html) | 录音、按住说一段话、导师评价、待核对 |
| 许衡 · 系统管理员 | [系统管理](https://qtalent-review.aidoudoulong123.workers.dev/y/app/admin.html?as=admin) | 账号与权限、北森同步、集成与审计；看不到人才数据 |

进入后也可以在顶栏切换视角。视角切换只是演示手段；原型按「先按权限过滤、再呈现」模拟服务端的行为，例如导师看不到象限，系统管理员打开业务页面会被整页拦下。

[评审导览页](https://qtalent-review.aidoudoulong123.workers.dev/) 把下面的走查路线做成了可点击的清单，第一次看建议从那里开始。

### 推荐走查路线

**1. 管理者首页：先看人，再找人**

| 看什么 | 入口 |
| --- | --- |
| 首页最上面的判断提醒：第六期 8 人前后判断不一致，下一行是待确认的周评标准修订 | [管理者工作台](https://qtalent-review.aidoudoulong123.workers.dev/y/app/index.html?as=ceo) |
| 值得关注的 13 人分三组，点「查看依据」看为什么关注 | [管理者工作台](https://qtalent-review.aidoudoulong123.workers.dev/y/app/index.html?as=ceo) |
| 为 MaaS 智能体平台找 owner：AI 起草需求卡，候选人逐条显示四态，拖进槽位后确认方案 | [找人](https://qtalent-review.aidoudoulong123.workers.dev/y/app/staffing.html?project=pr-agent&as=ceo) |

**2. 导师：记录、核对与对人复盘**

| 看什么 | 入口 |
| --- | --- |
| 手机首页：录音、一句话记录、导师评价三个入口和所带学员 | [手机首页](https://qtalent-review.aidoudoulong123.workers.dev/y/m/index.html) |
| 按住说一段话，自动转写后整理成关键事件 | [按住说话](https://qtalent-review.aidoudoulong123.workers.dev/y/m/quick.html?hold=1) |
| 核对「小孟」「分镜那个组」指谁：列出候选，选定后生成事件 | [手机待办](https://qtalent-review.aidoudoulong123.workers.dev/y/m/inbox.html) |
| W8 导师评价：10 名学员逐个确认，有冲突和待确认项 | [导师评价](https://qtalent-review.aidoudoulong123.workers.dev/y/m/mentor.html) |
| 孟逸尘的 W8 对人复盘：AI 草拟每一维的评价，分差 2 分转 HR 复核 | [对人复盘](https://qtalent-review.aidoudoulong123.workers.dev/y/app/landing-review.html?id=p-x11&as=mentor) |
| 在工作台「我的推荐」里推荐学员的发展方向 | [导师工作台](https://qtalent-review.aidoudoulong123.workers.dev/y/app/index.html?as=mentor) |

**3. 桌面录音：边录边看**

| 看什么 | 入口 |
| --- | --- |
| 录一场导师团复盘：逐句出现的实时文字、打标记、随手记、@某人、暂停与继续 | [录音](https://qtalent-review.aidoudoulong123.workers.dev/y/app/recording.html?as=hrbp) |
| 网络中断：第 8 秒断开、第 20 秒恢复，计时照走，结束时先补传 | [网络中断](https://qtalent-review.aidoudoulong123.workers.dev/y/app/recording.html?as=hrbp&net=drop) |
| 刷新后回来：选继续录音或结束并整理 | [刷新恢复](https://qtalent-review.aidoudoulong123.workers.dev/y/app/recording.html?as=hrbp&step=resume) |
| 结束后处理中：依次走转写中、整理中、部分待核对 | [处理中](https://qtalent-review.aidoudoulong123.workers.dev/y/app/recording.html?as=hrbp&step=processing) |
| 麦克风未授权：改为打字或上传已有录音 | [未授权](https://qtalent-review.aidoudoulong123.workers.dev/y/app/recording.html?as=hrbp&mic=deny) |

**4. HR：第六期结营盘点到留用与落位**

| 看什么 | 入口 |
| --- | --- |
| 工作台里有变化的人：4 人的象限可能要重新校准 | [HR 工作台](https://qtalent-review.aidoudoulong123.workers.dev/y/app/index.html?as=hrbp) |
| 评分复核：分差 2 分、改了 AI 分没写理由、参考位置跨象限三类条目 | [评分复核](https://qtalent-review.aidoudoulong123.workers.dev/y/app/queue.html?as=hrbp) |
| 结营盘点：93 人与中期对比，资料不足的 30 人写出缺哪条事件 | [盘点批次](https://qtalent-review.aidoudoulong123.workers.dev/y/app/review.html?id=b-xe6-end&as=hrbp) |
| 按课题组校准象限并冻结 | [象限校准](https://qtalent-review.aidoudoulong123.workers.dev/y/app/calibrate.html?id=b-xe6-end&as=hrbp) |
| 留用与落位方案：每条动作写依据、本人意愿和可否释放 | [留用与落位方案](https://qtalent-review.aidoudoulong123.workers.dev/y/app/plan.html?id=b-xe6-end&as=hrbp) |

**5. 判断对照：周评准不准，改哪条规则**

| 看什么 | 入口 |
| --- | --- |
| 第六期判断对照：前段评为最高或最低一档的 24 人里 8 人不一致；采纳 AI 归因假设 | [判断对照（HR）](https://qtalent-review.aidoudoulong123.workers.dev/y/app/judge.html?id=jr-xe6&as=hrbp) |
| 起草维度与锚点 rubric-v2：专业度按岗位族分锚点，生效点从下一个盘点批次开始 | [人才评价规则](https://qtalent-review.aidoudoulong123.workers.dev/y/app/rules.html?r=rubric&as=hrbp) |
| 管理者只看汇总，看不到按评价人的数字 | [判断对照（管理者）](https://qtalent-review.aidoudoulong123.workers.dev/y/app/judge.html?id=jr-xe6&as=ceo) |
| 管理者确认周评标准 xe-weekly-v2：看改了什么和影响范围 | [确认规则修订](https://qtalent-review.aidoudoulong123.workers.dev/y/app/rules.html?r=front&as=ceo) |

**6. 人才项目：按关键节点复盘**

| 看什么 | 入口 |
| --- | --- |
| 第六期关键节点时间线：每个节点标出复盘状态 | [关键节点](https://qtalent-review.aidoudoulong123.workers.dev/y/app/actions.html?as=hrbp) |
| 结营评审节点待复盘：AI 草拟「做得好」「要改进」，采用或改写后署名 | [结营评审节点](https://qtalent-review.aidoudoulong123.workers.dev/y/app/actions.html?node=pg-xe6:end&as=hrbp) |
| W4 周评节点的改进事项：判断对照生成的修订挂在这里 | [W4 周评节点](https://qtalent-review.aidoudoulong123.workers.dev/y/app/actions.html?node=pg-xe6:w4&as=hrbp) |
| 管理者只看已署名的复盘 | [管理者视角](https://qtalent-review.aidoudoulong123.workers.dev/y/app/actions.html?as=ceo) |

**7. 系统管理员：只管系统配置**

| 看什么 | 入口 |
| --- | --- |
| 账号与权限：给 HR 增加期次需管理者确认 | [账号与权限](https://qtalent-review.aidoudoulong123.workers.dev/y/app/admin.html?as=admin) |
| 北森同步：同步哪些数据、写到哪里、怎么用 | [北森同步](https://qtalent-review.aidoudoulong123.workers.dev/y/app/admin.html?tab=hr&as=admin) |
| 打开业务页面会被整页拦下，标题里没有人名 | [被拦下的工作台](https://qtalent-review.aidoudoulong123.workers.dev/y/app/index.html?as=admin) |

### 全部页面

桌面版（`prototype/y/app/`）：

| 页面 | 侧栏位置 | 谁能看到 | 示例入口 |
| --- | --- | --- | --- |
| 工作台 | 工作台 | 管理者、HR、导师 | [管理者](https://qtalent-review.aidoudoulong123.workers.dev/y/app/index.html?as=ceo) · [HR](https://qtalent-review.aidoudoulong123.workers.dev/y/app/index.html?as=hrbp) · [导师](https://qtalent-review.aidoudoulong123.workers.dev/y/app/index.html?as=mentor) |
| 人才 | 人 › 人才（导师显示为「所带学员」） | 管理者、HR、导师 | [管理者](https://qtalent-review.aidoudoulong123.workers.dev/y/app/people.html?as=ceo) · [导师](https://qtalent-review.aidoudoulong123.workers.dev/y/app/people.html?as=mentor) |
| 人员档案 | 从人才列表进入 | 管理者、HR、导师（导师看不到象限） | [管理者](https://qtalent-review.aidoudoulong123.workers.dev/y/app/person.html?id=p-x11&as=ceo) · [导师](https://qtalent-review.aidoudoulong123.workers.dev/y/app/person.html?id=p-x11&as=mentor) |
| 记一件事 | 工作台、⌘K | 管理者、HR、导师 | [导师](https://qtalent-review.aidoudoulong123.workers.dev/y/app/record.html?as=mentor) |
| 录音 | 工作台「上传材料」 | HR、导师 | [HR](https://qtalent-review.aidoudoulong123.workers.dev/y/app/recording.html?as=hrbp) |
| 待核对 | 工作台待办 | 管理者、HR、导师 | [HR](https://qtalent-review.aidoudoulong123.workers.dev/y/app/inbox.html?as=hrbp) |
| 盘点 / 盘点批次 | 人 › 盘点 | 管理者、HR | [盘点列表](https://qtalent-review.aidoudoulong123.workers.dev/y/app/reviews.html?as=hrbp) · [结营盘点](https://qtalent-review.aidoudoulong123.workers.dev/y/app/review.html?id=b-xe6-end&as=hrbp) |
| 象限校准 | 从盘点批次进入 | HR | [HR](https://qtalent-review.aidoudoulong123.workers.dev/y/app/calibrate.html?id=b-xe6-end&as=hrbp) |
| 留用与落位方案 | 从盘点批次进入 | 管理者、HR | [HR](https://qtalent-review.aidoudoulong123.workers.dev/y/app/plan.html?id=b-xe6-end&as=hrbp) |
| 评分复核 | 人 › 评分复核 | HR | [HR](https://qtalent-review.aidoudoulong123.workers.dev/y/app/queue.html?as=hrbp) |
| 人才项目（期次） | 项目 › 人才项目 | 管理者、HR、导师 | [HR](https://qtalent-review.aidoudoulong123.workers.dev/y/app/landing.html?as=hrbp) |
| 关键节点复盘 | 项目 › 人才项目（管理者直接进入） | 管理者、HR | [管理者](https://qtalent-review.aidoudoulong123.workers.dev/y/app/actions.html?as=ceo) · [HR](https://qtalent-review.aidoudoulong123.workers.dev/y/app/actions.html?as=hrbp) |
| 对人复盘 | 从人才项目进入 | HR、导师 | [导师](https://qtalent-review.aidoudoulong123.workers.dev/y/app/landing-review.html?id=p-x11&as=mentor) |
| 项目与课题 / 项目详情 | 项目 › 项目与课题 | 管理者、HR、导师 | [项目列表](https://qtalent-review.aidoudoulong123.workers.dev/y/app/projects.html?as=ceo) · [MaaS 智能体平台](https://qtalent-review.aidoudoulong123.workers.dev/y/app/project.html?id=pr-agent&as=ceo) |
| 找人 | 从项目详情进入 | 管理者、HR | [管理者](https://qtalent-review.aidoudoulong123.workers.dev/y/app/staffing.html?project=pr-agent&as=ceo) |
| 人才评价规则 | 规则 › 人才评价规则 | 管理者、HR | [HR](https://qtalent-review.aidoudoulong123.workers.dev/y/app/rules.html?as=hrbp) · [管理者](https://qtalent-review.aidoudoulong123.workers.dev/y/app/rules.html?r=front&as=ceo) |
| 判断对照 | 规则 › 我的判断对照 | HR、导师看自己范围；管理者从首页提醒进入，只看汇总 | [HR](https://qtalent-review.aidoudoulong123.workers.dev/y/app/judge.html?id=jr-xe6&as=hrbp) · [导师](https://qtalent-review.aidoudoulong123.workers.dev/y/app/judge.html?rater=me&as=mentor) |
| 标签库 | 规则 › 标签库（HR 侧栏） | HR、管理者 | [HR](https://qtalent-review.aidoudoulong123.workers.dev/y/app/tags.html?as=hrbp) |
| 系统管理 | 系统 › 系统管理 | 系统管理员 | [系统管理员](https://qtalent-review.aidoudoulong123.workers.dev/y/app/admin.html?as=admin) |

导师手机版（`prototype/y/m/`，桌面浏览器里显示在手机框中）：

| 页面 | 入口 |
| --- | --- |
| 工作台 | [m/index.html](https://qtalent-review.aidoudoulong123.workers.dev/y/m/index.html) |
| 记录（按住说话） | [m/quick.html](https://qtalent-review.aidoudoulong123.workers.dev/y/m/quick.html?hold=1) |
| 录音 | [m/record.html](https://qtalent-review.aidoudoulong123.workers.dev/y/m/record.html) |
| 待办与核对 | [m/inbox.html](https://qtalent-review.aidoudoulong123.workers.dev/y/m/inbox.html) |
| 导师评价 | [m/mentor.html](https://qtalent-review.aidoudoulong123.workers.dev/y/m/mentor.html) |
| 人才 / 人员档案 | [m/people.html](https://qtalent-review.aidoudoulong123.workers.dev/y/m/people.html) · [m/person.html](https://qtalent-review.aidoudoulong123.workers.dev/y/m/person.html?id=p-x11) |
| 我的 | [m/me.html](https://qtalent-review.aidoudoulong123.workers.dev/y/m/me.html) |

另外还有：[设计系统](https://qtalent-review.aidoudoulong123.workers.dev/y/design-system.html)（颜色、字体、组件、状态与小犇 IP 形象的规范和样张）、[产品架构与分期规划](https://qtalent-review.aidoudoulong123.workers.dev/architecture.html)。

### 演示说明

- 原型里的 AI 行为（整理 SBI、建议分、找人四态、转写、复盘草拟）都是预置结果，按真实节奏流式输出，用来验证体验和规则，不调用真实模型。
- 演示中的操作只保存在你的浏览器本地，彼此互不影响。想从头再看，在导览页或「更多 → 重置演示数据」清空。
- 象限参考位置、变化提醒、档案版本都由原型按规则从已确认的事件分实时算出，所以确认或改分后会看到相应变化。

## 本地运行原型

原型是独立的 HTML、CSS 和 JavaScript，不需要安装依赖或构建。在仓库根目录运行：

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory prototype
```

打开 <http://127.0.0.1:4173/> 进入评审导览，上文所有入口把域名换成 `http://127.0.0.1:4173/` 即可访问。也可以用任何静态文件服务器托管 `prototype/` 目录。

## 正式工程（赛后延续，进行中）

比赛交付的是原型。团队同时在仓库根目录按正式工程标准搭建可上线的版本，赛后在同一工程上继续：界面 1:1 还原原型 Y，接真实数据库、服务端权限和真实 AI 与语音服务（七牛 MaaS、Jev、七牛 Kodo、通义听悟）。

目前已合入登录、外壳、项目与课题页，授权核心，证据模型与演示数据导入，前后端契约，任务进度，四个外部服务的适配器和设计系统组件；工作台、人才读取、记一件事、找人、录音上传等正在评审。逐条链路的状态见 [架构设计第 12 节](docs/architecture.md#12-实现状态)。

<details>
<summary>运行正式工程</summary>

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

以上步骤不需要任何外部凭据，目前已合入的页面也不调用外部服务。七牛 MaaS、Jev、Kodo、通义听悟的适配器只在服务端显式创建，自动测试使用测试替身；接入真实服务时，所需环境变量见各适配器的 README（`src/server/integrations/*/README.md`），部署相关变量见 [deploy/README.md](deploy/README.md)。

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

</details>

## 技术栈

- **原型**：原生 HTML、CSS、JavaScript，无构建；自建「光与墨」设计系统与小犇 IP 形象；评审站用 Cloudflare Worker + D1。
- **正式工程**：Next.js 16（App Router）· React 19 · TypeScript · Tailwind CSS 4 · Radix · Motion · PostgreSQL 17 · Drizzle ORM · pg-boss · Better Auth · Zod · Vitest · Playwright；外部服务为七牛 MaaS（DeepSeek V4.1 Flash）、Jev、七牛 Kodo、通义听悟。

原型的结构、正式工程的模块规格、权限模型和部署方式见 [架构设计](docs/architecture.md)。

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
- 远端仓库建立后，每一次变更都通过 Pull Request 合入 `main`，经 CI 和审查；建仓时一并推送的 9 条初始提交保留了原来的顺序、作者和时间。

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [架构设计](docs/architecture.md) | 原型结构、正式工程的模块规格、数据流、权限、部署、实现状态、分工 |
| [需求定稿 · 版本 Y](docs/requirements/需求定稿-版本Y.md) | 版本 Y 的需求，未提及部分沿用 [需求定稿 v1.6](docs/requirements/需求定稿-v1.6.md) |
| [架构分期提案](docs/proposals/2026-10-25-y-architecture-phases.md) | 长期 / 中期 / 本次比赛的规划与决策记录 |
| [工程规范](docs/engineering.md) | 职责划分、契约、测试与覆盖率、UI 还原与验证 |
| [界面文案规范](docs/ui-copy.md) | 面向用户的文案写法 |
| [协作规范](CONTRIBUTING.md) | Issue、Proposal、Commit 与 PR |
| [AGENTS.md](AGENTS.md) | 编码 Agent 的共同入口、阶段约束与产品不变量 |
| [评审站](review-site/README.md) | 原型发布与划线评论 |

仓库里还保留了更早的版本 X 原型（`prototype/app/`、`prototype/m/`，五种角色），作为设计演进的记录，评审导览页同样有入口。

## 数据与隐私

演示数据全部是化名并标「演示」。`docs/sources/` 的原始材料和 `docs/design-refs/` 的设计参考只在本地保留，不随仓库分发。仓库不包含任何密钥或生产凭据。
