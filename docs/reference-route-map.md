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
| `app/staffing.html`               | `/staffing?new=1` 或 `?project=…` | staffing / staffing.ts | staffing / staffing                          | 路由已按角色拦截；活文档组件在开发样张 `/dev/staffing`，真实读取待 BOW-852、854 |
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

## BOW-851 找人契约

`src/contracts/staffing.ts` 定义需求卡起草、编辑与确认、候选人逐条四态判断及来源、署名人工判断，以及复用 jobs 的 `staffing_match` 进度消息。方案槽位、方案确认和冻结保持 `not_connected`。

本切片只交付契约与合成测试；`/staffing?new=1` 与 `?project=…` 的查询、动作和页面由 BOW-852、BOW-853、BOW-854 接入，当前继续返回 404。契约不将加分项换成候选排名，不向前端输出 confidence。

## BOW-858：上传、录音与附件契约

依据 [SDD v1.1](https://linear.app/bowenzhong/document/5c7ff2471a3f)。`src/contracts/media.ts` 只定义输入/输出与合成用例，不代表下列路由、动作或前端已接通；现有未实现路由仍返回 404。

| 页面 / 入口 | 读取与动作门面 | 契约与状态 | 实现责任 |
| --- | --- | --- | --- |
| 工作台上传材料、记事附件 | requestUpload、completeUpload、readOriginal | uploadRequest / uploadGrant / uploadCompleted；共用稳定 recordCollectionId，当前记录累计 10 个、单个 2×1024³ 字节；实际内容与当前权限服务端校验 | 873 / 861 / 870 |
| 工作台长任务 | readMedia、后台 job retry/resume/cancel | mediaRead / mediaJobSnapshot，复用 jobs.ts；needs_review→awaiting_manual，已产出待确认草稿→completed，不表示人工已确认 | 842 / 859 / 861 |
| 待核对·说话人 | bind / defer / mark_irrelevant / unbind | speakerItem / speakerCommand / bindingResult；人名与项目未接入 | 860 / 862 |
| 桌面实时录音 | 浏览器↔常驻进程 WebSocket | recordingClientMessage / recordingServerMessage；ack 仅表示独立完整音频段已验证归档，preview 永远不是正式事件来源 | 868 / 869 |
| 文字附件解析 | parse / readMedia | attachmentParseResult；parsing→running/partial、parsed→completed、unsupported→failed；扫描件不冒充空成功；未 parsed 不可保存事件 | 866 / 870 |

- 仅支持 MP3/M4A/WAV/AAC、TXT/DOCX/文字型 PDF。文件名/MIME 一致性仅是声明检查，服务端仍须检查实际内容、累计数量和授权。上传凭证只含受约束 token、服务器指定 key；客户端不能选 bucket/key。原件读取经授权应用代理，不返回私有供应商读签名。
- recordCollectionId 是当前记录（新建草稿或既有记录）的稳定附件集合不透明身份，请求必须携带，凭证与完成响应回显同一身份；跨文件、重试和编辑保持不变，与 target 人员或事件分开。它只是客户端提供的查找身份，不授予权限。873 resolver 每次同时接收 recordCollectionId + target，验证集合归属、记录写授权与目标范围后解析到可信 quotaScope，以事务中的权威计数判断额度；不能相信客户端 existingAttachmentCount 或让客户端指定 quotaScope。前端取得集合身份、873 resolver 接线和持久业务由对应任务实现，本卡没有新增草稿路由。
- 归档完成时 source 可以为 null，表示解析或转写尚未产生真实片段；后续有 source 时复用公共 fragmentId / originalVersionId 并验证版本一致。禁止为满足完成响应编造占位 fragment。
- readOriginal 严格接受两种查找身份：引用路径 `{fragmentId, originalVersionId, range?}`，或原件路径 `{originalId, originalVersionId, range?}`；混合或不完整身份被拒绝。873 必须独立校验当前认证、记录/上传归属、版本属于该原件及整份内容授权，未知或不完整分类继续 fail closed，不能凭版本 ID 或上传人身份默认放行。schema 只验证输入形状，不宣称已查数据库或所有 source:null 文件当前可读；扫描件本期仍为 unsupported，不能据此保存事件。
- 产品上限保持单文件 2×1024³ 字节。856 适配器当前 1 GiB 是实现能力缺口；大于当前能力且不超过产品上限的服务端申请应明确返回 unavailable，不能冒充格式 unsupported，也不能偷偷降低产品上限或只调高能力参数就声称已支持。真实 2 GiB 链路由 856/873 后续完成验收；BOW-858 合并门禁按本章当前批准的核对、CI 与远审执行，不另增真实联调条件。
- 快照内 result 严格白名单；浏览器上传字节进度不混入后台持久状态。媒体阶段 queued→queued、transcribing/parsing/shaping→running、needs_review→awaiting_manual、completed/parsed→completed、failed/unsupported→failed、cancelled→cancelled。partial 仅用于仍在 transcribing/parsing/shaping 且已有可安全展示的部分结果，不用于纯等待说话人绑定；unsupported 通过媒体阶段保留“暂不支持”语义，不当作已解析或空文本成功。
- 取消命令沿用 operationId/expectedRevision，关闭页面或取消订阅不是取消任务；cancelRequestedAt 是持久栅栏，只有安全停止才 cancelled。失败重试新 attempt，旧结果不能覆盖当前。业务事务由 842/859/860 实现，本契约验证不等于这些行为已验收。
- 离线稿有 transcriptVersionId，实时预览没有可用于事件提取的来源身份。音频来源统一 fragmentId + originalVersionId + recording 时间段；文档使用真实段号，PDF 可带真实页码，不为 TXT/DOCX 虚构页码。
- 完整原件归档、离线转写及确定片段保存不等说话人绑定；事件整理只在全部说话人已绑定或明确无关后恢复。defer 不满足恢复门槛。撤销使依赖旧绑定修订的未确认草稿失效、保留历史，已确认结果须另行修订，不自动删除或重算；与确认的竞态由后端同事务校验。
- 浏览器协议与供应商协议分离，采用 PCM16 little-endian / 单声道 / 16kHz。chunk JSON 头后接一帧二进制，868 核实际字节数、SHA-256、窗口/帧上限和授权；这些运行参数仍由 868 spec 冻结。sequence 从 1 开始、连续归档水位从 0 开始；同段同摘要去重，不同摘要冲突。ack 的 sequence 表示本次确认的段，archivedThrough 表示当前连续归档水位；重发旧段时累计水位可高于该 sequence。finish 必须等所有已发段归档及容器完整性校验后才发 archived 并触发一次离线链路。
- 原 SDD 的前端负责人评审要求保留为历史。用户于 2026-10-25 17:31 UTC 明确批准改用独立原型/消费核对、CI 与远审后由协调方统一合入，当前不再等待原前端负责人，也不冒称前端签字。固定核心 1afd40e 的独立原型/消费核对已完成并通过，无本期结构阻断；CI 与远审仍以发布组合为准。本表不宣称真实上传或真实听悟验收通过。

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

### 页面卡共用的比较接口（`tests/visual/compare.ts`）

页面卡需要在上述基线之外登记差异时，只用下面几个接口，不改 `reference-config.ts`；不传新参数时行为与此前相同。

| 接口                                                           | 用途                                                                                                                                                                                                                               |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `normalizeRegions(原型页, 工程页, { omit, replace })`          | 比较前整理 DOM。`omit` 只作用于原型侧（工程不渲染、版面会错位的区块）；`replace` 把两侧同一选择器的第 i 个匹配替换成等大的空占位盒，匹配数不同直接报错，容器宽度不同会软失败                                                       |
| `matchingMasks(原型页, 工程页, 额外选择器)`                    | 整页或首屏比较的页面级遮罩，与 `referenceConfig.masks` 合并，两侧实际区域取并集。页面自己的遮罩由页面传入，不放进全局配置                                                                                                          |
| `compareElements(原型, 工程, testInfo, 名称, { mask, snap })`  | 元素比较。`mask` 是写在原型侧的元素内选择器，两侧各自换算成相对元素左上角的矩形，取并集后在相同相对位置覆盖（宽度对齐之后测量，由 `maskWithin` 完成）；`snap` 先用 `snapLayout` 把两侧元素的布局纵坐标取整，避免文字基线整行差 1px |
| `expectSameBox(原型元素, 工程元素, 名称, { keys, tolerance })` | 几何先于像素：软断言文档坐标下的矩形一致，默认四项、容差 1px                                                                                                                                                                       |

调用顺序固定：`normalizeRegions` → `stabilize` → `matchingMasks` → `compare` / `compareElements`；`expectSameBox` 必须在 `compareElements` 之前，因为后者会把工程元素宽度改成原型宽度。

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

## P0 工作台、人员与来源合同（BOW-836）

依据：[已交叉审规格](https://linear.app/bowenzhong/document/51834ba3247b)。仅新增 Zod 合同和合成夹具，不实现页面或读取。前端 BOW-839/840/841 负责人评审仍是独立合入条件，本表不宣称已获评审。原型基线仍为 `prototype-reference.json` 的 `2e51b50`，没有新遮罩或 UI 修改。

| 消费页面 / 区块 | 合同字段 | 数据来源 / 当前表达 | 后续责任 |
| --- | --- | --- | --- |
| `/work` 问候与入口 | `workbench.greeting / entries` | directory 身份及服务端授权；合同就绪，查询尚未接入 | BOW-838/841 |
| 管理者找人入口 | `findPeople` | 仅可用动作，不包含找人结果 | BOW-838；P2 找人链路 |
| 管理者判断提醒、值得关注的人/项目、我的关注 | `judgmentReminders / noteworthyPeople / noteworthyProjects / myWatch` | evaluation-system / talent / programs；固定 `not_connected` | P2/P4 对应链路 |
| HR 有变化的人、判断对照 | `changedPeople / judgmentComparison` | talent / evaluation-system；固定 `not_connected` | P4/P7 对应链路 |
| HR/导师待办与材料任务 | `todos / materialTasks` | records / jobs；固定 `not_connected`，无伪零角标 | P3 待办汇总与材料链路 |
| 导师学员 / 推荐 | `trainees / recommendations` | directory + records 授权学员可 ready/empty/insufficient_evidence/unknown；推荐固定 `not_connected` | BOW-838/841；推荐后续卡 |
| `/people` 列表、速览 | `peopleList / quickView` | directory、records、staffing 公开入口；合同就绪，读取/UI 未接入 | BOW-837/839 |
| `/person?id=…` 摘要 | `summary` | directory 身份；records 已授权事实、自述、人工结论分性质呈现 | BOW-837/840 |
| 档案能力谱 | `capabilityProfile` | records 确认表维度分：锚点、评价人、规则版本、有效来源及 sourceCategory；演示种子的 prototype_baseline 例外计入，无 AI 建议分 | BOW-834/835/837/840 |
| 档案小象限 | `referencePosition` | talent 当前有效确认分计算；只给参考分类或资料不足/未知，不设新阈值，无正式位置 | BOW-837/840 |
| 校准轨迹、档案版本与变化 | `calibrationHistory / versionsAndChanges` | talent 盘点冻结未接入；固定 `not_connected` | 后续盘点冻结链路 |
| 管理观察 / AI 推断 | `managementObservations / aiInferences` | records 按性质与当前权限分别投影，AI 继承来源权限 | BOW-835/837/840 |
| 时间线、参与项目 | `timeline / projects` | records / staffing 已授权公开入口 | BOW-837/840 |
| 所有引用角标展开 | `sourceReadInput / sourceReadResult` | records 的 fragmentId + originalVersionId + location；每次核对关联及当前权限，不整件返回 | BOW-834/835/837；播放 URL 由 BOW-873 后续接入 |

状态规则：已接入的事实块 `ready` 必有非空 payload；`empty` 仅表示权限范围内确无记录；`insufficient_evidence` / `unknown` 带原因而无数值。来源读取失败沿用 `validation_error / forbidden / not_found / conflict`，不得伪装空状态。加载中是前端本地状态。未接入区块只含 `{status: 'not_connected'}`，不携带伪计数、数组或业务记录。

角色规则：档案摘要、能力谱、时间线、项目供管理者、范围内 HR、所带学员导师读取；管理观察、小象限、校准轨迹、版本变化仅管理者/范围内 HR。导师严格变体不含这些字段，也没有 hiddenN；系统管理员无业务成功变体，查询入口拒绝后使用现有通用权限提示。AI 推断只可来自该角色已授权来源。schema 是边界校验，不替代服务端授权。

列表按授权 → 姓名/岗位检索与团队筛选 → teamName、name、id 稳定排序；本次有界演示目录不分页，total 恰为可见筛选结果数。排序由 BOW-837 查询实现并测试，合同不重排数据、不提供 score 或校准变化参数。ID tie-break 仅确保重名稳定，非人才排名。

来源位置为 document（可选 page、必填 paragraph）、spreadsheet（sheet、cell）、recording（startMs、endMs）或 snapshot_field（fieldPath，可选 originalLocation）。按 BOW-834 已定方案 A，固定原型作为 prototype_snapshot 原件登记，片段定位到 events[id].srcs[i] 或 events[id].act；originalLocation 仅为原表位置说明，不伪装单元格坐标。来源详情必须区分 sourceCategory=original / prototype_baseline，后者要求 demo=true，携带原件 displayNotice「原型基线 2e51b50，评语按原意压缩」，不得冒充原观察表。快照 commit/blob 由 originalVersionId 对应版本承载，不逐位置重复。无版本/位置不成引用，不用合成夹具补齐真实链路。录音播放 URL 在 P0 完全省略，不能包含永久公开地址或存储 key。读取输入不接受调用者 role。

前端开发夹具：`tests/fixtures/p0-contracts.ts`，只含 `test-*` 标识和明确合成描述，涵盖三角色、ready/empty/insufficient_evidence/unknown/not_connected、来源拒绝。不得作为生产 fallback。测试：`src/contracts/p0-contracts.test.ts`；不改变工程共享配置与覆盖率排除。

BOW-837 只读取确认表，演示环境的 prototype_baseline 与正常确认分一样参加能力谱和参考位置；原型 AI 建议及资料不足不计入。这个合同不决定授权或正式导入许可，正式入口拒绝 prototype_baseline 由 BOW-834 保证。前端负责人需评审新增快照位置、来源类别与提示的展示；当前尚无该验收证据。

## BOW-844 记事与评分复核契约

`src/contracts/record.ts` 定义整理草稿、确认、改分和五秒撤销的输入输出；`review-queue.ts` 定义两类评分复核与带理由校准。冻结位置复核保持 `not_connected`，不作为评分校准成功条目。

本切片只交付契约与合成测试，不创建业务页面或写入服务。`/record` 的读写与 UI 由 BOW-845、BOW-846、BOW-847 接入；`/queue` 由 BOW-848、BOW-849 接入。两路当前继续返回 404；后台处理进度复用 jobs 契约。

## 找人（BOW-853）

`src/features/staffing/` 是找人活文档：一句话 → 起草需求卡（跟随 `staffing_demand` 任务）→ 编辑（切换必须 / 加分、补一句要求）→ 确认 → 候选人逐条四态与出处、处理进度、待人工判断时选四态并署名。区块只读 `view.ts` 的视图模型；契约修订只改映射。页面动作经 `ports.ts` 的 `StaffingPorts` 从路由传入，客户端不引用 server。

- `/staffing`：服务端先按账号角色拦截，导师看到「这一页属于其他视角」，系统管理员看到业务视角提示；管理者、HR 现在看到「找人待接通」，不显示样张数据。需求读取（BOW-852）与匹配读取（BOW-854）合入后，把 `StaffingPorts` 接到 Server Action 与 `/api/jobs/[jobId]`，页面改为渲染 `Staffing`。
- 开发样张 `/dev/staffing?role=manager|hr&scene=ts|agent|new`：原型 Y 种子数据经找人契约渲染，来源都标为原型基线；动作是内存假实现。生产构建返回 404。
- 排序只用契约的 `orderStaffingCandidates`（必须项支持了几条），同数保持读取顺序；必须项至少两条资料不足、没有一条支持、且没有还在处理或待人工判断的要求的人，放进「条件待确认」。不出总分、胜任率或百分比。
- 匹配入口：契约没有「取确认后的匹配任务」的读取，`StaffingPorts.openMatching` 是对 BOW-854 的接口假设，返回任务标识或 `null`（这时显示「候选人核对待接通」）。
- 新项目入口（`?new=1`）：契约的起草需要 `projectId`，一句话建项目不在找人契约里；页面在入口绑定项目，起草完成后由 `onDemandReady` 交回页面跳转。
- 工作台交接：读取并删除 `sessionStorage['niu-talent:draft:staffing']`（约定见 BOW-841 `send.ts`），账号不符或超过 10 分钟丢弃。

**同次渲染截图对比**（`tests/visual/staffing.spec.ts`，遮罩与说明在 `tests/visual/staffing-masks.ts`）：管理者 `pr-agent`、HR `pr-ts` 项目页与管理者入口，桌面 1366×900 与窄屏 375×812。先比文字（标题、状态、要求、候选人姓名、逐条状态与证据句），再比位置与间距，最后逐元素比像素。

| 原型元素                                                                             | 工程处理                           | 原因                                                    |
| ------------------------------------------------------------------------------------ | ---------------------------------- | ------------------------------------------------------- |
| 右栏方案槽位、版本、确认、手动补入（`#plan`）                                        | 不渲染，保留空栏位                 | 方案契约 `not_connected`（D11：决赛找人止于四态和出处） |
| 候选卡「放入」按钮、拖放（`.n-candidate` 的 grab 光标）                              | 不渲染                             | 同上                                                    |
| 候选卡「演示」徽标、届别、在几个项目、相关维度分、发展方向、意愿与释放（`.n-cmeta`） | 不渲染；只比姓名与逐条要求         | 契约候选人只有 `id / name / orgName`                    |
| 头像按人着色                                                                         | 统一中性色                         | 契约无色相；遮罩                                        |
| 需求卡「来自」行的提出人和日期、角色行                                               | 只显示原话；不渲染角色             | 契约无提出人、日期、角色                                |
| 要求改写成宽松说法（`.nt-req`），AI 徽标里的「点要求可以改写」 | 不渲染；徽标去掉这半句 | 契约无备选说法；文案不承诺页面上没有的功能；遮罩 `.nt-req`；徽标折行不同，标题行只比标题 |
| 「检索 N 人」                                                                        | 只显示进入候选的人数               | 契约无检索范围人数；遮罩 `#cand-meta`                   |
| 原型里不带引用角标的「支持 / 不支持」 | 每条明确结论都有引用角标 | 契约要求明确结论必须有来源；遮罩 `.n-cite` |
| 入口的目标角色模板（`.n-tpls`），副标题「或者从目标角色模板开始」 | 不渲染；副标题去掉这半句，截图只比标题 | 模板没有契约；文案不承诺页面上没有的功能（`docs/ui-copy.md`） |
| 起草轨迹五步（含检索与核对） | 两步：理解需求、起草需求卡 | 确认后才匹配，起草任务只产出需求卡 |

**原型没有设计、按设计系统组合的部分**（待 BOW-925 前端覆盖检查确认）：需求卡确认行（墨色按钮「确认需求」+ 说明；确认后一行「某某 MM-DD 确认」）；候选卡里的处理进度（设计系统「处理进度」徽标与说明，「失败」和四态分开）；人工判断表单（四态文字选择、可引用来源勾选、「理由（必填，会署名留档）」、墨色「署名确认」，沿用判断对照的归因样式）；署名结论显示为「人工结论」标记 + 判断人与日期。
