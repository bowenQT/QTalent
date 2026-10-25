# 参考切片路由与模块映射

本表对应 BOW-830 工程基础；设计基线由根目录 `prototype-reference.json` 唯一维护。`prototype/` 与 `review-site/` 保留不改。标为「后续 / 404」的路由使用统一 404，不建设占位业务页。原型查询参数保留其业务含义。

## 已实现路由

| 原型                 | 工程路由             | features                                               | contracts            | 服务端入口                                      | 领域                                 | 状态                                       |
| -------------------- | -------------------- | ------------------------------------------------------ | -------------------- | ----------------------------------------------- | ------------------------------------ | ------------------------------------------ |
| 原型没有登录页       | `/login`             | `auth/LoginForm`                                       | Better Auth 登录协议 | `/api/auth/sign-in/email`、`/api/auth/sign-out` | 认证                                 | 邮箱密码登录、错误保留输入、阻止重复点击   |
| `app/js/shell.js`    | `(desk)/layout`      | `shell/Shell`、`AccountMenu`、`CommandMenu`            | `shell.ts`           | `queries/shell.ts`                              | directory、programs 授权             | 按服务端导航渲染，账号菜单退出后回登录     |
| `app/projects.html`  | `/projects`          | `projects/Projects`、`ProjectCard`、`NewProjectDialog` | `projects.ts`        | `queries/projects.ts`、`actions/projects.ts`    | directory、programs、staffing、audit | 管理者 / HR / 导师列表、状态筛选、新建项目 |
| `design-system.html` | `/dev/design-system` | 基础组件样张                                           | —                    | 路由中的生产环境门禁                            | —                                    | 仅开发环境；生产返回 404                   |
| `404.html`           | 全局 `not-found.tsx` | `components/ui/State`                                  | —                    | Next.js 404                                     | —                                    | 通用返回入口                               |

`/` 仅重定向 `/projects`；登录后的导航「工作台」指向 `/work`，仍返回 404，不借参考切片冒充已完成的工作台。

## 全量原型页面规划

下表的 feature、contract 和 server 入口是后续任务的建议边界，不代表已创建文件或对未来接口作出承诺。

| 原型页（`prototype/y/` 相对路径） | 工程路由                          | 后续 feature / contract             | 后续读取、动作 / 领域                        | 当前状态       |
| --------------------------------- | --------------------------------- | ----------------------------------- | -------------------------------------------- | -------------- |
| `app/index.html`                  | `/work`                           | workbench / workbench               | workbench / 多领域聚合                       | 后续 / 404     |
| `app/people.html`                 | `/people`                         | people / people                     | people / directory、talent                   | 后续 / 404     |
| `app/person.html`                 | `/person?id=…`                    | person / person                     | person / directory、records、talent          | 后续 / 404     |
| `app/record.html`                 | `/record`                         | record / record.ts | record / records、talent | 契约已定义，读写与 UI 待接入 / 404 |
| `app/inbox.html`                  | `/inbox`                          | inbox / inbox                       | inbox / records                              | 后续 / 404     |
| `app/queue.html`                  | `/queue`                          | queue / review-queue.ts | queue / talent | 契约已定义，读写与 UI 待接入 / 404 |
| `app/reviews.html`                | `/reviews`                        | reviews / reviews                   | reviews / talent                             | 后续 / 404     |
| `app/review.html`                 | `/review?id=…`                    | review / review                     | review / talent                              | 后续 / 404     |
| `app/calibrate.html`              | `/calibrate`                      | calibrate / calibrate               | calibrate / talent                           | 后续 / 404     |
| `app/plan.html`                   | `/plan?id=…`                      | plan / plan                         | plan / talent、staffing                      | 后续 / 404     |
| `app/landing.html`                | `/programs`                       | programs / programs                 | programs / programs                          | 后续 / 404     |
| `app/landing-review.html`         | `/program-review`                 | program-review / program-review     | program-review / programs、evaluation-system | 后续 / 404     |
| `app/actions.html`                | `/program-actions`                | program-actions / program-actions   | program-actions / programs                   | 后续 / 404     |
| `app/projects.html`               | `/projects`                       | projects / projects                 | projects / staffing                          | 已实现参考切片 |
| `app/project.html`                | `/project?id=…`                   | project / project                   | project / staffing                           | 后续 / 404     |
| `app/staffing.html`               | `/staffing?new=1` 或 `?project=…` | staffing / staffing                 | staffing / staffing                          | 后续 / 404     |
| `app/rules.html`                  | `/rules`                          | rules / rules                       | rules / evaluation-system                    | 后续 / 404     |
| `app/judge.html`                  | `/judge?rater=me`                 | judge / judge                       | judge / evaluation-system                    | 后续 / 404     |
| `app/tags.html`                   | `/tags`                           | tags / tags                         | tags / talent                                | 后续 / 404     |
| `app/admin.html`                  | `/admin`                          | admin / admin                       | admin / directory、平台                      | 后续 / 404     |
| `m/index.html`                    | `/m`                              | mobile-workbench / mobile-workbench | mobile-workbench / 多领域聚合                | 后续 / 404     |
| `m/mentor.html`                   | `/m/mentor`                       | mobile-mentor / mobile-mentor       | mobile-mentor / programs                     | 后续 / 404     |
| `m/quick.html`                    | `/m/quick`                        | mobile-quick / mobile-quick         | mobile-quick / records                       | 后续 / 404     |
| `m/record.html`                   | `/m/record`                       | mobile-record / mobile-record       | mobile-record / records                      | 后续 / 404     |
| `m/inbox.html`                    | `/m/inbox`                        | mobile-inbox / mobile-inbox         | mobile-inbox / records                       | 后续 / 404     |
| `m/people.html`                   | `/m/people`                       | mobile-people / mobile-people       | mobile-people / directory                    | 后续 / 404     |
| `m/person.html`                   | `/m/person?id=…`                  | mobile-person / mobile-person       | mobile-person / directory、talent            | 后续 / 404     |
| `m/me.html`                       | `/m/me`                           | mobile-account / mobile-account     | mobile-account / directory                   | 后续 / 404     |
| `design-system.html`              | `/dev/design-system`              | 已移植基础组件                      | —                                            | 已实现开发样张 |
| `404.html`                        | 全局 404                          | State                               | —                                            | 已实现         |

## BOW-844 记事与评分复核契约

`src/contracts/record.ts` 定义整理草稿、确认、改分和五秒撤销的输入输出；`review-queue.ts` 定义两类评分复核与带理由校准。冻结位置复核保持 `not_connected`，不作为评分校准成功条目。

本切片只交付契约与合成测试，不创建业务页面或写入服务。`/record` 的读写与 UI 由 BOW-845、BOW-846、BOW-847 接入；`/queue` 由 BOW-848、BOW-849 接入。两路当前继续返回 404；后台处理进度复用 jobs 契约。

## 已移植组件与样式

- `tokens.css`、`components.css`、`desk.css`、`mobile.css` 分别原样复制原型的 tokens、components、app、m 样式。`globals.css` 单独维护 Radix portal 定位适配，关闭 Tailwind Preflight；Tailwind 主题只引用原型语义变量。
- React 基础组件：Button、Badge、Field、Avatar、Icon、Dialog、State。Dialog 与账号菜单使用 Radix 的焦点约束、Escape 和键盘行为，保留原型类名及外观。错误、忙碌与禁用状态由切片组件处理。
- 小犇 SVG、尺寸分级与状态 CSS 从原型移植；`Niu` 使用 Motion，保留原型的 reduced-motion CSS。五张演示头像原样复制到 `public/avatars/`。
- 后续按页面实际需要迁移标签页、评分与证据组件、人才象限、人才项目复盘、录音、流式记录等，当前不建空组件。

## 已确认差异与待接入项

1. 顶栏「演示视角」按钮替换为账号菜单，显示账号、角色、退出与切换账号；切换账号真实退出再回登录，不改客户端角色。登录页、账号菜单没有原型对照样张，不作像素对比。
2. 工作台待办、盘点草稿和最近访问契约明确为 `not_connected`，页面省略；不是计数 0。评价数据接入前，导师导航暂显示「我的判断对照」，由对应任务接入真实评价关系后收口。
3. 命令面板只建立可访问导航的键盘外壳；人员、项目检索与 AI 动作由后续查询契约接入。面板不构造假搜索结果。
4. 新建后回到列表并提示「项目已创建」，项目详情链接仍返回 404。原型创建后进入详情，这处是参考切片范围要求的明确差异。
5. 新建项目所属组织固定第六期、结束日期固定 `2026-12-31`，由服务端赋值，界面不新增字段。两项默认值待后续需求确认后再扩展。
6. 系统管理员在查询人才数据前被拦，标题、面包屑与页面只显示通用权限提示；页面没有项目名称。权限提示按现行界面文案规范写为「这一页属于业务视角」。
7. 手机业务页不在范围；375×812 检查的是已实现桌面切片的响应式窄屏，与同视口桌面原型比较，不冒充手机业务页验收。

## 同次渲染视觉检查

`tests/visual/reference.spec.ts` 同次运行、同浏览器、同视口分别渲染原型和工程；每用例使用新上下文、独立临时 PostgreSQL 数据库、迁移与导入。原型静态服务只读取 `reference:prepare` 从固定 Git 提交物化的 `.reference-cache/`，再逐文件核对 `tests/fixtures/prototype-manifest.json` 的 Git blob SHA，拒绝混入变动后的原型。工作树中的原型后续变化不改变缓存基线；无 Git 的快照环境只能显式使用 `--verified-snapshot` 准备经摘要确认的等价基线，绝不静默回退到工作树。基线提交唯一来源为 `prototype-reference.json`，种子与截图服务共享该约束。

- 桌面 1366×900；响应式窄屏 375×812；三账号外壳 + 列表，新建弹窗，开发样张的输入、按钮、徽标。
- 先比较项目名称、顺序、目标；弹窗先比较完整 owner 选项。数据有差异即失败，不进入像素比较。
- 等待字体与图片解码，禁用动画、过渡和光标；演示日期均为 `2026-09-04`。
- 像素差阈值与容许差比例在 `tests/visual/reference-config.ts`，超过即失败；保存当次两侧及 diff 附件，不保存跨平台黄金图。
- 设计系统只比较对应控件区域；输入样张容器宽度与原型区域一致，避免样张布局不同被误算为控件差异，控件其他样式与内容不改。

| 同组遮罩选择器        | 原因                                                       | 取消条件                               |
| --------------------- | ---------------------------------------------------------- | -------------------------------------- |
| `.nt-top .n-menuwrap` | 账号菜单替换演示视角；更多菜单的原型重置功能不进入正式应用 | 账号菜单另做交互验收，保留这项明确差异 |
| `[data-nav-count]`    | 待办和草稿数据未接入，契约不捏造 0                         | 对应查询真实接入                       |
| `.nt-recent`          | 最近访问数据未接入                                         | 最近访问契约与查询接入                 |

遮罩采用两侧实际区域的并集，并在两侧相同坐标覆盖，避免因工程省略节点导致只遮一侧。其他业务内容、项目卡片、筛选器、弹窗字段均不遮罩。

## 实际验证与环境边界

- 单元 / 隔离组件测试覆盖筛选、空列表、导师隐藏入口、登录失败保留输入、账号退出失败、菜单键盘、弹窗校验和焦点、忙碌防重复、网络中断重放相同请求 ID、服务端错误保留表单、管理员页面门禁与生产样张 404。
- TDD 回归验证：原型日期 `09-04` 与错误实现 `9/4` 的测试先失败，再修复至原型 `slice(5)` 格式后通过。
- E2E 覆盖管理者 / HR / 导师的 22 / 22 / 19 个原型项目、管理员 0 个、创建、真实 Server Action 重放、统一 404、退出、键盘焦点。
- PostgreSQL 套接字在当前执行环境被拒绝。E2E、真实迁移/导入和同次截图对比已编写但尚未执行通过；不能用单测或构建代替。必须在允许独立本地 PostgreSQL 的环境实跑后才能给出像素结果和截图证据。

### 首轮 CI 浏览器反馈与修复

GitHub Actions run `40189366561`、受检 head `4a89159`：真实 PostgreSQL 检查通过，7 个 E2E 中 6 个通过，包含三个业务账号范围、管理员拦截、键盘焦点及真实 worker WebSocket。登录后的创建 / 重放 / 退出用例停在首次导航，后续动作尚待跑完。

trace 与 `app-output` 显示登录请求实际返回 200 并设置会话 cookie。该请求耗时 2597.69 ms，其中 Next 开发编译约 2400 ms，应用处理约 209 ms。随后只有一次 `/projects` RSC 请求，开始于 trace 单调时钟 55636.58 ms；Fast Refresh 在 55858.70 ms 开始编译，URL 断言在 58049.86 ms 超时并触发销毁。记录中没有登录失败、再次 `/login` 请求或取消导航证据，因此本次没有改动应用导航，也没有放宽 5 秒浏览器断言。

修复把首次编译纳入已存在的启动期限：fixture 交给浏览器前，以匿名只读请求预热 `/api/auth/get-session` 和 `/projects`，完整消费响应；前者必须 200 且为空会话，后者必须 303 / 307 指向同站 `/login`。异常状态直接失败，不用密码捷径建立会话，不碰浏览器 cookies。`tests/e2e/app-readiness.test.ts` 的 8 项单测覆盖顺序、完整消费、启动期限、错误状态、错误目标及意外会话；实际浏览器修复结果仍以新一轮 CI 为准。

### 同次截图采集规则补充

独立设计系统组件位于不同样例页面。比较先统一展示宽度并断言自然 CSS 宽高，再将两侧各自测得的小数坐标对齐最近整数像素起点，以消除裁剪栅格相位差；不改变字体、间距、尺寸或业务页面布局。附件保留自然/对齐矩形及每项差异数值。输入、按钮、徽标各为独立用例；任一定位或像素失败不阻止其他样例收集，软断言仍让任意超阈值导致失败。弹窗采用原生 dialog 等价的自动居中布局，不做截图专用 1px 样式补偿。

导师窄屏保留已登记的“我的判断对照”入口；当前项目项按原型末项的位置靠右对齐并保留导航内边距，新入口仍可横向滚动访问。基线、阈值与遮罩清单不变。

第三轮 CI 的输入样例两侧均为 464×62、起点均已对齐整数，剩余差异集中在文字的 LCD 彩色抗锯齿与灰阶抗锯齿。独立样例采集在两侧统一使用 `translateZ(0)` 零位移合成层，避免不同样张页面的合成条件影响文字栅格；此规则不进入生产 CSS，不改变字体、尺寸或阈值，实际像素结果仍须由下一轮 CI 确认。按钮选择器限定真实 `.n-btn`，不匹配隐藏菜单项；冻结原型 DOM 单测同时核对三个选择器唯一性、文案、输入值与徽标图标。当前视觉测试共 10 项。
