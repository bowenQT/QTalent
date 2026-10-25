**不能直接交给 Codex 执行；最大阻断是权限规则同时要求“照原型实现”和“遵守正式授权”，两者已有明确冲突，执行者必须自行裁决。** 本轮只读，未修改文件。

发现按严重程度排列：

1. **阻断｜§4.4、§6.2：原型不能作为正式权限真值。置信度 0.99。**  
   [store.js:1414](../../../prototype/y/app/js/store.js#L1414) 对导师直接放行所有 `p.batch` 项目；增加第二期数据后，导师会看到未带批次。HR 范围也仍按单个 `person.hrbp` 判断，而[提案:124](../../../docs/proposals/2026-10-25-y-architecture-phases.md#L124) 明确禁止照搬。目录却把授权所需的期次、名单和导师关系所属 `programs` 全部推迟。  
   **建议替换：**“界面以原型为准，授权以提案 §3.2 为准；纳入切片必需的期次、名单、导师关系，交付逐账号可见项目与可选人员清单，并测试跨期、撤权及伪造 owner/member ID。”

2. **重要｜§3.1、§3.6：导入限制挡住正常认证接入。置信度 0.99。**  
   [提示词:84](../../../docs/research/2026-10-25-y-architecture-alignment/engineering-foundation-prompt.md#L84) 禁止全部 `app/` 导入 `auth`，但 [Better Auth 标准 Route Handler](https://better-auth.com/docs/integrations/next) 正需要认证实例；照做会被自己的 CI 拦下，或被迫塞进 `queries`。客户端调用 Server Action 也不能与直接导入服务端实现混为一谈。[Next.js 说明](https://nextjs.org/docs/app/api-reference/directives/use-server)  
   **建议替换：**“页面读取经 queries；客户端仅可引用带 `'use server'` 的 actions；认证 Route Handler 可导入 auth 的协议入口，其余内部模块继续禁止。”

3. **重要｜§2、§3.5、§4.5：`server-only` 与独立 worker 的加载方式未闭合。置信度 0.98，执行后果为推断。**  
   [提示词:47](../../../docs/research/2026-10-25-y-architecture-alignment/engineering-foundation-prompt.md#L47) 要求每个服务端入口引入 `server-only`，又要求普通 Node worker 共用它；该包的[默认入口直接抛错](https://raw.githubusercontent.com/vercel/next.js/canary/packages/next/src/compiled/server-only/index.js)，不能假定 Node、Vitest、迁移脚本都享有 Next 的解析行为。  
   **建议替换：**“共享业务、认证核心与数据库代码不依赖 Next 请求上下文；Next 入口加 server-only，客户端禁入由依赖检查保证；必须实跑 worker、测试、迁移三种独立入口。”

4. **重要｜§4.3、§6.1：外壳 1:1 超出了已列数据范围。置信度 0.99。**  
   [shell.js:39](../../../prototype/y/app/js/shell.js#L39) 的角标依赖待办与盘点，导航还依赖评价关系，最近项则是预置内容。仅有人员、项目表无法还原；执行者容易硬编码数字，或扩做多个业务域。  
   **建议补写：**“新增外壳读取契约；未实现业务的角标、最近项明确使用仅演示模式启用的夹具，列入交付边界，不宣称为实时结果；正式环境不得把未知返回为 0。”若不接受演示夹具，就必须明确纳入相应真实读取范围。

5. **重要｜§5、§7：截图缺少可重复的数据前置条件。置信度 0.97，失败场景为推断。**  
   原型会复用同版本 localStorage（[store.js:32](../../../prototype/y/app/js/store.js#L32)）；工程的新建测试会改变数据库。即使账号、日期相同，两侧也可能不是同一状态。§7.2 比整个外壳，§7.3 排除账号菜单，比较区域也未定义。  
   **建议替换：**“静态基线固定取 `2e51b50`；每例重置浏览器存储和独立数据库，显式设置 `?as=`，固定排序、字体环境并等待字体就绪；账号菜单使用明确区域排除。先核对两侧数据断言，再比较截图。”

6. **重要｜§4.8：映射表不足以支持前后端并行。置信度 0.93，返工风险为推断。**  
   [工程规范:77](../../../docs/engineering.md#L77) 已要求明确文件范围和集成负责人，但提示词没有把它变成可验收产物。两个任务仍可能同时修改导航、样式、锁文件，或分别生成同一迁移序列；前后端也可能各自解释错误状态。  
   **建议补写：**“交付契约样例、错误语义、权限用例、任务可改文件清单及共享文件负责人；契约先合入再并行。迁移由集成负责人基于最新 main 统一生成，SQL 与快照/元数据一起提交；同步 Linear 任务与 GitHub PR 的关联规则。”

7. **次要｜§5：两个数据文件并不独立可执行。置信度 1.00。**  
   [data.js:89](../../../prototype/y/app/js/data.js#L89) 依赖 `core.js` 定义的 `NT.clone`。只读实测直接加载报错；补同款函数后，两次执行及定稿提交的种子哈希一致，得到 22 个项目。  
   **建议替换：**“隔离加载器仅提供 `window.NT` 与同语义 `clone`，执行后做 schema、唯一键和引用完整性校验；数据库与测试夹具均从此生成，不手工维护第二份数据。”本轮无需为了 JSON 单源改动原型。

目录只建议以下差异：

- `server/modules/programs/` 提前加入切片需要的最小关系模型与读取入口，避免把期次业务事实复制进 `directory`。
- `server/auth/` 内区分共享核心与 Next 适配文件；不新增通用 controller/service/repository 层。
- 增加 `contracts/shell.ts`、`server/queries/shell.ts`，明确外壳数据来源。
- 保留分域 `schema.ts`，让 [Drizzle glob](https://orm.drizzle.team/docs/drizzle-config-file) 收集，避免新增人人修改的 schema 汇总文件；shadcn 路径通过 [components.json aliases](https://ui.shadcn.com/docs/components-json) 固定即可。

三点应保留：

- 根目录单 package、按业务领域组织、只建实际使用的模块，适合作为正式工程起点，当前层次不需要整体推翻。
- 原型 CSS 与设计变量直接继承、shadcn 保留交互而重做外观的路线可行；[Tailwind 支持关闭 Preflight](https://tailwindcss.com/docs/preflight)，真正需要验证的是 DOM、弹层和状态样式的对应关系。
- “项目列表＋新建项目”能覆盖认证、授权、查询、事务和幂等，适合作为参考切片；外部服务暂用假实现、worker 只做骨架的范围应保留。
