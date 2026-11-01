# Niu-Talent

[![foundation](https://github.com/bowenQT/QTalent/actions/workflows/foundation.yml/badge.svg?branch=main)](https://github.com/bowenQT/QTalent/actions/workflows/foundation.yml)
[![codecov](https://codecov.io/gh/bowenQT/QTalent/branch/main/graph/badge.svg)](https://app.codecov.io/gh/bowenQT/QTalent)
[![coverage gate](https://img.shields.io/badge/coverage%20gate-%E2%89%A5%2085%25%20lines%20%26%20branches-blue)](docs/engineering.md#测试原则与-85-覆盖率基线)
[![online prototype](https://img.shields.io/website?url=https%3A%2F%2Fqtalent-review.aidoudoulong123.workers.dev%2F&label=online%20prototype)](https://qtalent-review.aidoudoulong123.workers.dev/)
[![last commit](https://img.shields.io/github/last-commit/bowenQT/QTalent/main)](https://github.com/bowenQT/QTalent/commits/main)

[![Node.js](https://img.shields.io/badge/Node.js-24%20LTS-5FA04E?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-11-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![TypeScript](https://img.shields.io/github/package-json/dependency-version/bowenQT/QTalent/dev/typescript?logo=typescript&logoColor=white&label=TypeScript&color=3178C6)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/github/package-json/dependency-version/bowenQT/QTalent/next?logo=nextdotjs&label=Next.js&color=000000)](https://nextjs.org/)
[![React](https://img.shields.io/github/package-json/dependency-version/bowenQT/QTalent/react?logo=react&logoColor=black&label=React&color=61DAFB)](https://react.dev/)
[![Tailwind CSS](https://img.shields.io/github/package-json/dependency-version/bowenQT/QTalent/tailwindcss?logo=tailwindcss&logoColor=white&label=Tailwind%20CSS&color=06B6D4)](https://tailwindcss.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Drizzle ORM](https://img.shields.io/github/package-json/dependency-version/bowenQT/QTalent/drizzle-orm?logo=drizzle&logoColor=black&label=Drizzle%20ORM&color=C5F74F)](https://orm.drizzle.team/)
[![Better Auth](https://img.shields.io/github/package-json/dependency-version/bowenQT/QTalent/better-auth?logo=betterauth&logoColor=white&label=Better%20Auth&color=000000)](https://www.better-auth.com/)
[![Zod](https://img.shields.io/github/package-json/dependency-version/bowenQT/QTalent/zod?logo=zod&logoColor=white&label=Zod&color=3E67B1)](https://zod.dev/)

[![Vitest](https://img.shields.io/github/package-json/dependency-version/bowenQT/QTalent/dev/vitest?logo=vitest&logoColor=white&label=Vitest&color=6E9F18)](https://vitest.dev/)
[![Playwright](https://img.shields.io/github/package-json/dependency-version/bowenQT/QTalent/dev/@playwright/test?logo=playwright&logoColor=white&label=Playwright&color=2EAD33)](https://playwright.dev/)
[![ESLint](https://img.shields.io/github/package-json/dependency-version/bowenQT/QTalent/dev/eslint?logo=eslint&logoColor=white&label=ESLint&color=4B32C3)](https://eslint.org/)
[![Prettier](https://img.shields.io/github/package-json/dependency-version/bowenQT/QTalent/dev/prettier?logo=prettier&logoColor=black&label=Prettier&color=F7B93E)](https://prettier.io/)
[![Cloudflare Workers](https://img.shields.io/badge/review%20site-Cloudflare%20Workers%20%2B%20D1-F38020?logo=cloudflareworkers&logoColor=white)](review-site/README.md)

七牛云内部的 AI 原生人才工作台，帮公司做好三件事：**找得到人**（人才搜索）、**看得清人**（人才档案）、**评得准人**（人才评价体系的建立与迭代）。AI 负责整理证据、起草判断，正式结论由有权限的人确认，每一条都能回到来源。

| | |
| --- | --- |
| 参赛议题 | 自选题目：AI 原生的人才搜索、档案与评价体系 |
| 交付形态 | 高保真可交互产品原型（桌面 + 导师手机版），浏览器直接打开 |
| 在线原型 | <https://qtalent-review.aidoudoulong123.workers.dev/>（`@qiniu.com` 邮箱登录，每页可划线评论） |
| Demo 视频 | 仓库内（`docs/demo/`）：[带讲解版](docs/demo/niu-talent-narrated.mp4) · [操作演示版](docs/demo/niu-talent-walkthrough.mp4) · [90 秒短片](docs/demo/niu-talent-90s.mp4) · [30 秒短片](docs/demo/niu-talent-30s.mp4)<br>Google Drive：[带讲解版](https://drive.google.com/file/d/1ZfX0eRM3sM1o3GMwPB_J4BH5MIBlngNo/view?usp=sharing) · [操作演示版](https://drive.google.com/file/d/1L2a9YWhO1Ff9z7VZW2va_fMQzyep2mIW/view?usp=sharing) · [90 秒短片](https://drive.google.com/file/d/1mJXs7BtGMy58aZPd1daLzJqJA3lXxK0p/view?usp=sharing) · [30 秒短片](https://drive.google.com/file/d/184f-nOHuBhl73kbH97CaOB1fNM97dmYc/view?usp=sharing)（带讲解版为原始画质） |
| 架构设计 | [docs/architecture.md](docs/architecture.md) |

## 为什么做

公司里关于「这个人行不行」的判断，依据散落在会议、周报、面试记录和导师印象里：

- **找人靠记忆**：要为一个新项目找 owner，只能问「谁认识合适的人」，说不清候选人凭什么合适。
- **档案是空的或是一句评语**：评语和分数离开了当时的情境，没人能回答「这个分是怎么来的」。
- **评价标准没人检验**：周评、面试、盘点各用一套口径，标准偏了也不知道，更谈不上改。

Niu-Talent 用一条证据链把三件事连起来：评价体系规定怎么判断，判断沉淀进档案，档案支撑搜索；搜索和盘点的结果再回头检验评价体系。

```mermaid
flowchart LR
  E[人才评价体系<br/>维度与锚点 · 规则版本] -->|按锚点整理和打分| P[人才档案<br/>可追溯的关键事件与确认分]
  P -->|已确认的证据| S[人才搜索<br/>需求卡逐条对照]
  S -->|任用与盘点的结果| J[判断对照<br/>前后两段判断放在一起]
  P --> J
  J -->|归因后起草修订| E
```

## 核心价值

演示数据是化名的 XEngineer 第六期（93 名学员、398 条事件），所有人员都标「演示」。下面每个价值点都附了原型的直达入口。

### 一、人才搜索：用一句话找到对的人，并说清凭什么

管理者写一句「MaaS 智能体平台要一个能牵头应用后端的人，10 月到岗」，系统帮他建项目、起草需求卡，再拿公司里**已确认的证据**逐条对照候选人。

- **需求卡由 AI 起草、人来定稿**：要求分「必须」和「加分」，可以逐条改写；常用岗位沉淀为目标角色模板，下次直接套用。
- **逐条给结论，不给总分**：每条要求只有「支持 / 不支持 / 资料不足 / 证据冲突」四种状态，每个状态都能点开看到原文、表格单元格或录音时间点。候选人按「必须项支持了几条」排列，不按分数排序；「资料不足」和「不支持」分开，不会把没记录当成不行。
- **方案确认后才生效**：候选人拖进方案的角色槽位，管理者确认后写入项目成员，形成可回溯的版本。
- **日常检索**：人才列表按团队和姓名排列，可按标签筛选；标签只用于检索和找人，不参与打分。

| 体验什么 | 入口 |
| --- | --- |
| 为 MaaS 智能体平台找 owner：需求卡、逐条四态、拖进槽位、确认方案 | [找人（管理者）](https://qtalent-review.aidoudoulong123.workers.dev/y/app/staffing.html?project=pr-agent&as=ceo) |
| 从一句话开始找人，先建项目和需求卡 | [新的找人](https://qtalent-review.aidoudoulong123.workers.dev/y/app/staffing.html?new=1&as=ceo) |
| 人才列表：按团队浏览、标签筛选、重点跟踪 | [人才（管理者）](https://qtalent-review.aidoudoulong123.workers.dev/y/app/people.html?as=ceo) |
| 目标角色与发展通道：找人用到的角色模板 | [目标角色模板](https://qtalent-review.aidoudoulong123.workers.dev/y/app/rules.html?r=tpl&as=ceo) |
| 标签库：收录、并入、停用候选标签 | [标签库（HR）](https://qtalent-review.aidoudoulong123.workers.dev/y/app/tags.html?as=hrbp) |

### 二、人才档案：每个判断都能回到原话

导师说一句话、HR 录一场复盘、上传一份材料，AI 把它们整理成关键事件（情境、行为、结果，即 SBI），按锚点给出建议分；评价人确认后才进入档案。

- **一条证据链**：材料 → 来源片段（页与段、单元格、时间点）→ 关键事件 → AI 建议分 → 人确认或改分 → 档案。档案里每一个分数都带行为锚点、原文引用、评分人和规则版本。
- **内容性质分开**：原始事实、本人自述、管理观察、AI 推断、人工结论分开存、分开显示，AI 的内容不会冒充人的结论。
- **档案会生长**：能力谱、象限与校准轨迹、档案版本与变化、时间线、参与的项目，都由已确认的事件实时算出；新事件让位置可能变化时，会提醒 HR 重新校准。
- **AI 先问，不乱猜**：「小孟」「分镜那个组」指谁、录音里的说话人是谁，AI 列出候选等人核对，选定后才生成事件。
- **同一份档案，按视角看到不同内容**：导师看不到象限和管理观察，员工看不到本人的分数，系统管理员看不到任何人才数据。

| 体验什么 | 入口 |
| --- | --- |
| 孟逸尘的档案：能力谱、象限与校准轨迹、档案版本、时间线，点引用回到原文 | [人员档案（管理者）](https://qtalent-review.aidoudoulong123.workers.dev/y/app/person.html?id=p-x11&as=ceo) |
| 同一份档案的导师视角：看不到象限 | [人员档案（导师）](https://qtalent-review.aidoudoulong123.workers.dev/y/app/person.html?id=p-x11&as=mentor) |
| 记一件事：一句话整理成 SBI 和建议分，确认或改分 | [记一件事](https://qtalent-review.aidoudoulong123.workers.dev/y/app/record.html?as=mentor) |
| 手机上按住说一段话，自动转写并整理成关键事件 | [按住说话](https://qtalent-review.aidoudoulong123.workers.dev/y/m/quick.html?hold=1) |
| 核对「小孟」「分镜那个组」指谁 | [手机待办](https://qtalent-review.aidoudoulong123.workers.dev/y/m/inbox.html) |
| 录一场导师团复盘：实时文字、打标记、@某人、暂停与继续 | [桌面录音](https://qtalent-review.aidoudoulong123.workers.dev/y/app/recording.html?as=hrbp) |
| 录音的异常情况：网络中断后补传、刷新后恢复、麦克风未授权 | [网络中断](https://qtalent-review.aidoudoulong123.workers.dev/y/app/recording.html?as=hrbp&net=drop) · [刷新恢复](https://qtalent-review.aidoudoulong123.workers.dev/y/app/recording.html?as=hrbp&step=resume) · [未授权](https://qtalent-review.aidoudoulong123.workers.dev/y/app/recording.html?as=hrbp&mic=deny) |

### 三、人才评价体系：标准先立起来，再用结果持续校准

评价体系是整套产品的地基：它决定 AI 怎么整理、评价人怎么打分、谁会被关注、象限怎么落位。Niu-Talent 把它做成一套**有版本、可检验、可迭代**的规则。

**建立：六类规则集中管理**

| 规则 | 决定什么 |
| --- | --- |
| 维度与锚点 | 每个维度 1–5 分各代表什么行为；记录打分、AI 建议分都按它，专业度按岗位族分锚点 |
| 象限落位 | 取多长时间的证据、分界线和落位门槛，决定参考位置和「资料不足」 |
| 值得关注 | 谁会出现在管理者首页「值得关注」里，按哪几条规则入选 |
| 前段评价标准与对应表 | 社招面试、入营选拔怎么评，以及和入职后的维度怎么对照 |
| 目标角色与发展通道 | 找人和发展方向用到的角色模板：职责、必须与加分要求 |
| 标签库 | 档案和找人里能用的标签 |

**执行：分数要经得起复核**

- 分数只有关键事件上的维度分（1–5），必须对上锚点；「资料不足 / 未体现」不出分。没有综合总分、排名、百分比和雷达图。
- 评价人之间分差 2 分以上、改了 AI 建议分却没写理由、新事件让参考位置跨象限，都会自动进入 HR 的评分复核。
- 盘点时系统给参考位置，HR 按课题组校准并冻结快照，再形成留用与落位方案。

**迭代：用后来的结果检验当初的判断**

- **判断对照**：把同一个人同一维度在前后两个阶段的判断放在一起，比如入营时的周评和结营时的评审，找出系统性偏差；AI 给出归因假设（评价人、标准还是评价方式），HR 采纳或改写后生成改进动作。后一阶段不当作标准答案，对照的结论只作用于评价体系，不改变任何人的分数和档案。
- **修订流程**：HR 起草修订、写明理由与依据、预览影响范围，管理者对比新旧版本后确认发布或退回；规则经历草稿、待确认、已排期、生效中、已替代几个状态；入营选拔标准例外，确认发布后即对之后新建的期次生效，没有「已排期」。
- **不改写历史**：新版本按生效点生效，已有的分数、冻结快照和档案版本保持原样；盘点进行中不切换所用版本。
- **保护评价人**：按评价人的偏差只给 HR 和评价人本人看，管理者只看汇总，不做评价人排行。

| 体验什么 | 入口 |
| --- | --- |
| 六类规则总览、版本历史与对比 | [人才评价规则（HR）](https://qtalent-review.aidoudoulong123.workers.dev/y/app/rules.html?as=hrbp) |
| 起草维度与锚点 rubric-v2：专业度按岗位族分锚点，生效点定在下一个盘点批次 | [维度与锚点](https://qtalent-review.aidoudoulong123.workers.dev/y/app/rules.html?r=rubric&as=hrbp) |
| 管理者确认周评标准修订：看改了什么、为什么改、影响多少对照单元 | [确认修订（管理者）](https://qtalent-review.aidoudoulong123.workers.dev/y/app/rules.html?r=front&as=ceo) |
| 第六期判断对照：前段评为最高或最低一档的 24 人里 8 人不一致，采纳 AI 归因 | [判断对照（HR）](https://qtalent-review.aidoudoulong123.workers.dev/y/app/judge.html?id=jr-xe6&as=hrbp) |
| 管理者看判断对照：只有汇总和已确认的归因 | [判断对照（管理者）](https://qtalent-review.aidoudoulong123.workers.dev/y/app/judge.html?id=jr-xe6&as=ceo) |
| 评分复核：分差 2 分、改分无理由、跨象限三类条目 | [评分复核（HR）](https://qtalent-review.aidoudoulong123.workers.dev/y/app/queue.html?as=hrbp) |
| 结营盘点 → 按课题组校准象限 → 留用与落位方案 | [盘点批次](https://qtalent-review.aidoudoulong123.workers.dev/y/app/review.html?id=b-xe6-end&as=hrbp) · [象限校准](https://qtalent-review.aidoudoulong123.workers.dev/y/app/calibrate.html?id=b-xe6-end&as=hrbp) · [留用与落位](https://qtalent-review.aidoudoulong123.workers.dev/y/app/plan.html?id=b-xe6-end&as=hrbp) |
| 导师的 W8 对人复盘：AI 草拟每一维的评价，分差大的转 HR | [对人复盘](https://qtalent-review.aidoudoulong123.workers.dev/y/app/landing-review.html?id=p-x11&as=mentor) |
| 关键节点复盘：判断对照生成的「修订周评标准」挂在 W4 周评节点下 | [W4 周评节点](https://qtalent-review.aidoudoulong123.workers.dev/y/app/actions.html?node=pg-xe6:w4&as=hrbp) |

## 体验原型

### 按角色进入

| 角色 | 入口 | 这个角色在三件事里做什么 |
| --- | --- | --- |
| 程远 · 管理者 | [桌面工作台](https://qtalent-review.aidoudoulong123.workers.dev/y/app/index.html?as=ceo) | 为项目找人、看值得关注的人、确认评价规则的修订 |
| 苏晚 · HR | [桌面工作台](https://qtalent-review.aidoudoulong123.workers.dev/y/app/index.html?as=hrbp) | 整理档案、评分复核、盘点校准、做判断对照、起草规则修订 |
| 叶青 · 导师 | [桌面工作台](https://qtalent-review.aidoudoulong123.workers.dev/y/app/index.html?as=mentor) | 记录所带学员、确认本人评分、对人复盘、提规则修订建议 |
| 叶青 · 导师手机版 | [手机首页](https://qtalent-review.aidoudoulong123.workers.dev/y/m/index.html) | 录音、按住说一段话、导师评价、待核对 |
| 许衡 · 系统管理员 | [系统管理](https://qtalent-review.aidoudoulong123.workers.dev/y/app/admin.html?as=admin) | 账号与权限、北森同步、集成与审计；看不到人才数据 |

进入后也可以在顶栏切换视角。视角切换只是演示手段；原型按「先按权限过滤、再呈现」模拟服务端的行为，例如导师看不到象限，系统管理员打开业务页面会被整页拦下。[评审导览页](https://qtalent-review.aidoudoulong123.workers.dev/) 还按角色整理了一份逐步走查清单。

### 全部页面

桌面版（`prototype/y/app/`）：

| 价值点 | 页面 | 谁能看到 | 示例入口 |
| --- | --- | --- | --- |
| 人才搜索 | 人才 | 管理者、HR、导师（导师显示为「所带学员」） | [管理者](https://qtalent-review.aidoudoulong123.workers.dev/y/app/people.html?as=ceo) · [导师](https://qtalent-review.aidoudoulong123.workers.dev/y/app/people.html?as=mentor) |
| 人才搜索 | 找人 | 管理者、HR | [管理者](https://qtalent-review.aidoudoulong123.workers.dev/y/app/staffing.html?project=pr-agent&as=ceo) |
| 人才搜索 | 项目与课题 / 项目详情 | 管理者、HR、导师 | [项目列表](https://qtalent-review.aidoudoulong123.workers.dev/y/app/projects.html?as=ceo) · [MaaS 智能体平台](https://qtalent-review.aidoudoulong123.workers.dev/y/app/project.html?id=pr-agent&as=ceo) |
| 人才搜索 | 标签库 | HR、管理者 | [HR](https://qtalent-review.aidoudoulong123.workers.dev/y/app/tags.html?as=hrbp) |
| 人才档案 | 人员档案 | 管理者、HR、导师（导师看不到象限） | [管理者](https://qtalent-review.aidoudoulong123.workers.dev/y/app/person.html?id=p-x11&as=ceo) · [导师](https://qtalent-review.aidoudoulong123.workers.dev/y/app/person.html?id=p-x11&as=mentor) |
| 人才档案 | 记一件事 | 管理者、HR、导师 | [导师](https://qtalent-review.aidoudoulong123.workers.dev/y/app/record.html?as=mentor) |
| 人才档案 | 录音 | HR、导师 | [HR](https://qtalent-review.aidoudoulong123.workers.dev/y/app/recording.html?as=hrbp) |
| 人才档案 | 待核对 | 管理者、HR、导师 | [HR](https://qtalent-review.aidoudoulong123.workers.dev/y/app/inbox.html?as=hrbp) |
| 评价体系 | 人才评价规则 | 管理者、HR | [HR](https://qtalent-review.aidoudoulong123.workers.dev/y/app/rules.html?as=hrbp) · [管理者](https://qtalent-review.aidoudoulong123.workers.dev/y/app/rules.html?r=front&as=ceo) |
| 评价体系 | 判断对照 | HR、导师看自己范围；管理者只看汇总 | [HR](https://qtalent-review.aidoudoulong123.workers.dev/y/app/judge.html?id=jr-xe6&as=hrbp) · [导师](https://qtalent-review.aidoudoulong123.workers.dev/y/app/judge.html?rater=me&as=mentor) |
| 评价体系 | 评分复核 | HR | [HR](https://qtalent-review.aidoudoulong123.workers.dev/y/app/queue.html?as=hrbp) |
| 评价体系 | 盘点 / 盘点批次 | 管理者、HR | [盘点列表](https://qtalent-review.aidoudoulong123.workers.dev/y/app/reviews.html?as=hrbp) · [结营盘点](https://qtalent-review.aidoudoulong123.workers.dev/y/app/review.html?id=b-xe6-end&as=hrbp) |
| 评价体系 | 象限校准 | HR | [HR](https://qtalent-review.aidoudoulong123.workers.dev/y/app/calibrate.html?id=b-xe6-end&as=hrbp) |
| 评价体系 | 留用与落位方案 | 管理者、HR | [HR](https://qtalent-review.aidoudoulong123.workers.dev/y/app/plan.html?id=b-xe6-end&as=hrbp) |
| 评价体系 | 人才项目（期次） | 管理者、HR、导师 | [HR](https://qtalent-review.aidoudoulong123.workers.dev/y/app/landing.html?as=hrbp) |
| 评价体系 | 对人复盘 | HR、导师 | [导师](https://qtalent-review.aidoudoulong123.workers.dev/y/app/landing-review.html?id=p-x11&as=mentor) |
| 评价体系 | 关键节点复盘 | 管理者、HR | [管理者](https://qtalent-review.aidoudoulong123.workers.dev/y/app/actions.html?as=ceo) · [HR](https://qtalent-review.aidoudoulong123.workers.dev/y/app/actions.html?as=hrbp) |
| 入口 | 工作台 | 管理者、HR、导师 | [管理者](https://qtalent-review.aidoudoulong123.workers.dev/y/app/index.html?as=ceo) · [HR](https://qtalent-review.aidoudoulong123.workers.dev/y/app/index.html?as=hrbp) · [导师](https://qtalent-review.aidoudoulong123.workers.dev/y/app/index.html?as=mentor) |
| 平台 | 系统管理 | 系统管理员 | [账号与权限](https://qtalent-review.aidoudoulong123.workers.dev/y/app/admin.html?as=admin) · [北森同步](https://qtalent-review.aidoudoulong123.workers.dev/y/app/admin.html?tab=hr&as=admin) |

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

- 原型里的 AI 行为（起草需求卡、四态判断、整理 SBI、建议分、转写、归因假设、复盘草拟）都是预置结果，按真实节奏流式输出，用来验证体验和规则，不调用真实模型。
- 演示中的操作只保存在你的浏览器本地，彼此互不影响。想从头再看，在导览页或「更多 → 重置演示数据」清空。
- 象限参考位置、变化提醒、档案版本都由原型按规则从已确认的事件分实时算出，所以确认或改分后会看到相应变化。

## 本地运行原型

原型是独立的 HTML、CSS 和 JavaScript，不需要安装依赖或构建。在仓库根目录运行：

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory prototype
```

打开 <http://127.0.0.1:4173/> 进入评审导览，上文所有入口把域名换成 `http://127.0.0.1:4173/` 即可访问。也可以用任何静态文件服务器托管 `prototype/` 目录。

## 正式工程（进行中）

团队在仓库根目录按正式工程标准开发可上线的版本，赛后在同一工程上继续：界面 1:1 还原原型 Y，接真实数据库、服务端权限和真实 AI 与语音服务（七牛 MaaS、Jev、七牛 Kodo、通义听悟）。决赛的正式工程演示环境正在部署，进度见 [#25](https://github.com/bowenQT/QTalent/issues/25)。

三个价值点在工程里的落地顺序是：先把评价体系的数据底座（维度、锚点、规则版本）和证据模型建好，再接人才档案的读取与记一件事，然后是人才搜索的需求卡与逐条四态。目前已合入登录与外壳、授权核心、证据与评分模型、演示数据导入、人才与来源读取、记一件事 / 评分复核 / 找人 / 上传的前后端契约、标准迭代与期次授权契约、任务进度、四个外部服务的适配器（含听悟离线与实时）和设计系统组件。正在评审的有：工作台与档案的读取和页面、记一件事的整理与确认、找人的需求卡与逐条四态、录音上传与说话人绑定、附件与面评解析、评价体系的生效版本读取、标准发布与判断对照，以及企业微信与 MCP 入口。逐条状态见 [架构设计第 12 节](docs/architecture.md#12-实现状态)。

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

三个价值点在原型和正式工程里分别由哪些模块支撑、权限模型和部署方式，见 [架构设计](docs/architecture.md)。

## 团队与分工

团队成员：bowenQT、Joanrecruiting、yiyih7077-cell。团队使用 Codex、Cursor、Claude Code 等编码 Agent 在各自的分支上并行实现 Linear 任务卡，成员负责拆卡、审查与合并。协作方式见 [架构设计第 13 节](docs/architecture.md#13-分工)。

## 开发过程

- 本项目从零开发，没有引入既有 codebase。
- 需求、设计和架构决策都留在仓库里：[需求定稿](docs/requirements/)、[架构分期提案](docs/proposals/2026-10-25-y-architecture-phases.md)、[调研与审查记录](docs/research/)。
- 远端仓库建立后，每一次变更都通过 Pull Request 合入 `main`，经 CI 和审查；建仓时一并推送的 9 条初始提交保留了原来的顺序、作者和时间。

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [架构设计](docs/architecture.md) | 三个价值点的模块支撑、原型结构、正式工程的模块规格、数据流、权限、部署、实现状态、分工 |
| [北森数据与权限对接清单](docs/research/2026-10-25-北森对接清单.md) | 可提供的数据、缺口、HR 最小权限申请项和待联调验收 |
| [需求定稿 · 版本 Y](docs/requirements/需求定稿-版本Y.md) | 版本 Y 的需求，未提及部分沿用 [需求定稿 v1.6](docs/requirements/需求定稿-v1.6.md)（评价体系见其第 3.35 节） |
| [架构分期提案](docs/proposals/2026-10-25-y-architecture-phases.md) | 长期 / 中期 / 本次比赛的规划与决策记录 |
| [工程规范](docs/engineering.md) | 职责划分、契约、测试与覆盖率、UI 还原与验证 |
| [界面文案规范](docs/ui-copy.md) | 面向用户的文案写法 |
| [协作规范](CONTRIBUTING.md) | Issue、Proposal、Commit 与 PR |
| [AGENTS.md](AGENTS.md) | 编码 Agent 的共同入口、阶段约束与产品不变量 |
| [评审站](review-site/README.md) | 原型发布与划线评论 |

仓库里还保留了更早的版本 X 原型（`prototype/app/`、`prototype/m/`，五种角色），作为设计演进的记录，评审导览页同样有入口。

## 数据与隐私

演示数据全部是化名并标「演示」。`docs/sources/` 的原始材料和 `docs/design-refs/` 的设计参考只在本地保留，不随仓库分发。仓库不包含任何密钥或生产凭据。
