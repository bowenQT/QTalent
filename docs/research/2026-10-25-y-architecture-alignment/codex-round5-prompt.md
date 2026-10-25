<task>
继续之前的架构讨论。这一轮请你以「将要执行这份提示词、搭建工程基础的 Codex」和「对抗审查者」两种身份，审查一份交给 Codex 的工程基础提示词。只读，不要修改任何文件。

待审提示词：docs/research/2026-10-25-y-architecture-alignment/engineering-foundation-prompt.md

用户 2026-10-25 的新决定（当作已确定输入，不要主张推翻，但可以指出没处理好的后果）：
- U-18：比赛的工程不再是可丢弃验证，按正式工程标准，放仓库根目录，作为第 3 阶段正式工程起点。
- U-19：UI/UX 以 main 提交 2e51b50 的原型 Y 与 Y 设计系统页为定稿，工程 1:1 还原。
- U-20：这次只交付「底座 + 一条参考切片」。
- U-21：工程基础合入后，由 Claude 按前端 / 后端 / 其他类型拆 Linear 任务卡，多个 agent 并行认领开发。

必要时参照：AGENTS.md、CONTRIBUTING.md、docs/engineering.md、docs/proposals/2026-10-25-y-architecture-phases.md、docs/requirements/需求定稿-版本Y.md、prototype/y/（尤其 app/js/store.js、shell.js、pages/projects.js、assets/*.css）、v21（v21 研究工作区 `docs/proposals/2026-10-23-application-architecture.md`）。
</task>

<attack_surface>
- 目录与命名：是否适合「前端、后端、集成等不同 agent 并行开发、尽量不改同一批文件」；features / components / contracts / server(queries, actions, usecases, modules, authz, platform, integrations, jobs, db) 这套层次是否过多或缺了必要的一层；与 Next.js App Router、shadcn/ui CLI、Drizzle 的惯例是否冲突；会不会让并行开发集中改同一批热点文件（导航配置、schema、迁移、样式、锁文件），提示词是否给了处理办法。
- 1:1 还原策略：原样移植原型 CSS + Tailwind 主题映射 + shadcn 只取交互，这条路是否可行；Tailwind 的基础重置、字体、shadcn 组件结构与原型 DOM 结构不同会带来什么问题；截图对比「原型静态页 vs 工程页」是否可执行（原型的数据在 localStorage、视角来自 ?as=，工程数据来自数据库），需要哪些前置条件才不会成为长期失败的测试。
- 种子数据：在 Node 隔离环境执行原型的 data-xe6.js / data.js 取种子，是否可靠；有没有更好的单一来源做法。
- 参考切片选「项目与课题 + 新建项目」是否合适，能否作为前后端样板；还缺什么才能让后续 agent 照抄。
- 授权核心、Better Auth、常驻进程 WebSocket、适配器只做接口与假实现，这些范围在一个任务里是否过大或过小。
- 提示词本身：有没有歧义、相互矛盾、无法验收的要求；有没有会让执行者停下或走偏的地方；与 AGENTS.md、engineering.md、提案已有约定是否冲突。
- 为后续拆 Linear 卡，工程基础还应该额外产出什么（例如契约优先的约定、任务边界文件清单）。
</attack_surface>

<grounding_rules>
每个发现写明依据位置（提示词节号、仓库文件与行）；推断标明是推断并给置信度。只报实质问题，不提措辞风格。宁可一个强发现，不要多个弱发现。
</grounding_rules>

<structured_output_contract>
中文输出：
1. 总体判断：一句话，这份提示词能否直接交给 Codex 执行；最大的一条阻断理由（没有就写「无阻断」）。
2. 发现列表（按严重程度排序，最多 10 条）：严重程度（阻断 / 重要 / 次要）、位置、问题、具体失败场景、依据、建议改法（尽量给可直接替换的写法）、置信度。
3. 目录：如果你会改目录或命名，给出你建议的版本（只写差异和理由）。
4. 提示词里你认为正确、不应被改掉的三点，每点一句。
总长度约 2500 字以内。
</structured_output_contract>
