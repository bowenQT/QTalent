# 参考切片路由与模块映射

本表对应 BOW-830 工程基础；设计基线由根目录 `prototype-reference.json` 唯一维护。`prototype/` 与 `review-site/` 保留不改。标为「后续 / 404」的路由使用统一 404，不建设占位业务页。原型查询参数保留其业务含义。

## 已实现路由

| 原型                 | 工程路由             | features                                               | contracts            | 服务端入口                                      | 领域                                 | 状态                                       |
| -------------------- | -------------------- | ------------------------------------------------------ | -------------------- | ----------------------------------------------- | ------------------------------------ | ------------------------------------------ |
| 原型没有登录页       | `/login`             | `auth/LoginForm`                                       | Better Auth 登录协议 | `/api/auth/sign-in/email`、`/api/auth/sign-out` | 认证                                 | 邮箱密码登录、错误保留输入、阻止重复点击   |
| `app/js/shell.js`    | `(desk)/layout`      | `shell/Shell`、`AccountMenu`、`CommandMenu`            | `shell.ts`           | `queries/shell.ts`                              | directory、programs 授权             | 按服务端导航渲染，账号菜单退出后回登录     |
| `app/projects.html`  | `/projects`          | `projects/Projects`、`ProjectCard`、`NewProjectDialog` | `projects.ts`        | `queries/projects.ts`、`actions/projects.ts`    | directory、programs、staffing、audit | 管理者 / HR / 导师列表、状态筛选、新建项目 |
| 无独立原件页；设计系统 `#c-doc` 引用角标的「打开完整纪要」 | `/sources?fragment=…&version=…` | `sources/SourceViewer`、`SourceCite`、`source-href` | `sources.ts`（P0 读取；897 材料来源经 `fromMaterialSource`） | `queries/sources.ts` 的 `readSourceForCurrentUser` | records、talent 授权、audit | 只读；地址只带两个标识，位置由服务端解析；被拒与不存在同一个「原件链接失效」页；原件全文待 BOW-873 授权读取，显示「原件待接入」；原型没有对应页，视觉为参照待同步，交视觉审查 |
| `design-system.html` | `/dev/design-system` | 基础组件样张                                           | —                    | 路由中的生产环境门禁                            | —                                    | 仅开发环境；生产返回 404                   |
| 同上 | `/dev/design-system/sources`、`/dev/design-system/sources/view` | 原件查看器样张（六种定位、代码快照、基线、待接入） | `sources.ts` 校验后的合成样张 | 路由中的生产环境门禁 | — | 仅开发环境；生产返回 404 |
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
| `app/import.html`                 | `/import?id=…`                    | interview-import / （BOW-906 读取） | 面评导入预览 / records、directory            | 角色门禁已实现；预览读取待接通，样张 `/dev/import`；视觉参照待同步 |
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
| `app/staffing.html`               | `/staffing?new=1` 或 `?project=…` | staffing / staffing.ts | staffing / staffing                          | 契约已定义，查询与 UI 待接入 / 404 |
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

## BOW-907 面评导入预览

原型 `app/import.html`（BOW-898，#250，`81e4fd4`）还原到 `src/features/interview-import/`。BOW-906（导入决策，#277）和 BOW-900（解析，#257）不在 `main`，所以：

- `/import?id=…` 在服务端按角色拦截：系统管理员看「这一页属于业务视角」，HR 以外看「面评导入由 HR 处理」，HR 看「面评预览待接通」；缺 `id` 写「导入链接失效」。页面不读取任何面评数据。
- 预览、逐行确认、补录和放进待核对在开发样张 `/dev/import` 上运行，生产环境 404。演示数据取自原型 Y 种子 `imp-1`（化名，标「演示」）。
- 视图模型 `model.ts` 镜像 906 的决策词汇和 900 的 `Selection` 三态。906 每行只给第一个阻塞原因，预览要同时显示一行的全部待办（面试官待核对和待补录可以并存），所以读取需要返回逐行事实，行状态在前端推导。出口表按 #277 的实际出口（审查 [6558574643](https://github.com/bowenQT/QTalent/pull/277#issuecomment-6558574643)「待同步」）对齐，906 合入后把镜像换成它的契约，映射不变：

| 906（#277） | 行状态 |
| --- | --- |
| `duplicate` | 已导入过（折叠在「跳过的 N 行」，带「这份文件 … 导入过一次」提示） |
| `not_ready / parser_manual_input`（`unrecognized`） | 有分待补录，显示页面图并补录 |
| `needs_review(unknown_interview_candidate)`，目录里有这个人 | 待确认是谁（HR 在预览里确认，即 906 的 `confirmedCandidateId`） |
| `needs_review(unknown_interview_candidate)`，目录里查不到 | 待认人 → 已放进待核对 |
| `not_ready / candidate_match_unconfirmed` | 待确认是谁 |
| `skipped / not_hired`（HR 确认是谁之后） | 将跳过（折叠在「跳过的 N 行」） |
| `needs_review(unknown_interviewer)` | 面试官待核对 |
| `planned` | 已确认 |

- 淘汰和未入职：906 现在先认人、后看招聘状态，HR 确认是谁之前不跳过。目录里通常查不到这些人，所以原型种子里的唐语桐（淘汰）、宋知意（已发 offer · 未入职）在预览里是「待认人」，行内写「确认是谁之前不入档」，和原型「跳过的 3 行」不同。HR 确认之前能否直接跳过还在等所有者裁决（[#248 评论 6558715526](https://github.com/bowenQT/QTalent/issues/248#issuecomment-6558715526)）；如果改为提前跳过，只改 `rowState` 的顺序。
- `skipped / original_only` 在待核对里决定，不回到预览；`candidate_directory_missing` 在 #277 已不可达，从映射里删去。
- 「返回后保留」：每次确认、补录、放进待核对都经端口 `ports.ts` 提交，端口返回存好的那一行；离开再回来，读取到的行已带上这些结果。样张端口把它们存在本标签页的 sessionStorage。
- 待接通：导入已确认的行、撤销导入和导入记录（906 没有持久化和档案投影）。导入条上的按钮保持禁用，旁边写「导入待接通」。
- 链接：「去核对」「关联面试官」「查看待核对」按原型链到 `/inbox#…`，待核对页上线前返回 404。
- 和原型的差异：面包屑缺「工作台」上级（`route-nav` 别名属共享文件，已在 #248 登记）；导入条多一个「导入待接通」徽标；淘汰和未入职的两行见上；补录保存失败时选项留在框里，标「还没保存」并给「重试保存」。
- 新增样式暂放 `src/features/interview-import/interview-import.css`，逐字取自原型 `niu-components.css`（`81e4fd4`），全局样式同步后删除。
- 视觉对照：**参照待同步**。固定参照 `91b297a` 早于 #250，没有 `app/import.html`；本页按 `main` 上 `81e4fd4` 的原型实现，`91b297a` 里没有可比的部分，所以不写成视觉通过。`tests/visual/interview-import.spec.ts` 在参照缺页时整体跳过；同步到 `81e4fd4` 的请求见 [#248 评论 6557468925](https://github.com/bowenQT/QTalent/issues/248#issuecomment-6557468925)，参照更新后自动补跑。

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

依据：[已交叉审规格](https://linear.app/bowenzhong/document/51834ba3247b)、BOW-836 的 10/26 修订清单与[所有者恢复裁决](https://github.com/bowenQT/QTalent/issues/248#issuecomment-6553550926)。本片提供 Zod 合同、合成夹具及现有人才/来源读取的形状适配，不实现页面；工作台真实读取仍由 BOW-838 接入。消费 main 已冻结的 BOW-897，保留 #216 来源索引及 #284 的受限评价分类。工程原型参照以 `prototype-reference.json` 为准；历史原件的 `2e51b50` 是其固定来源证明，两者不混用。前端消费方评审仍是独立条件，本表不宣称已获评审。

| 消费页面 / 区块 | 合同字段 | 数据来源 / 当前表达 | 后续责任 |
| --- | --- | --- | --- |
| `/work` 问候、业务日与入口 | `workbench.greeting / asOf / entries` | directory 身份及服务端授权；`entries` 是动作授权唯一来源（管理者与 HR `record, find_people`、导师 `record`），导航由 shell 决定；查询由 `queries/workbench.ts` 提供页面包络与当前授权读取，UI 由 841 接入；`/work` 仍为 404 | BOW-838/841 |
| 管理者判断提醒、值得关注的人/项目、我的关注 | `judgmentReminders / noteworthyPeople / noteworthyProjects / myWatch` | evaluation-system / talent / programs；固定 `not_connected` | P2/P4 对应链路 |
| HR 有变化的人、判断对照 | `changedPeople / judgmentComparison` | talent / evaluation-system；固定 `not_connected` | P4/P7 对应链路 |
| HR/导师待办与材料任务 | `todos / materialTasks` | records / jobs；固定 `not_connected`，无伪零角标 | P3 待办汇总与材料链路 |
| 导师学员 / 推荐 | `trainees / recommendations` | `trainees` 是精简投影（头像四项、课题、本人本周记录活跃度 ready/unknown），不含摘要、分数、来源；推荐固定 `not_connected` | BOW-838/841；推荐后续卡 |
| `/people` 列表、速览 | `peopleList / quickView` | 身份（含 teamPath、level、batch、tenureLabel）、`projectLoad`、`recentFacts`（≤3，原文角标）、`capabilityLines`（无窗口，只有事件数与锚点）；先授权后聚合；合同及既有读取形状已适配，页面/结果包络接入由消费卡完成 | BOW-837/839 |
| `/person?id=…` 摘要 | `summary` | 署名、有日期的人工结论，带授权类别 `category`；事实与自述在时间线，AI 在 `aiInferences` | BOW-837/840 |
| 档案能力谱 | `capabilityProfile` | 服务端按 `asOf` 前 365 天（含边界日）切窗口，带 `windowFrom`、维度状态与窗口内确认分（锚点、评价人姓名、规则版本、来源、事件）；分差 ≥ 2 的证据冲突不计入；演示种子的 prototype_baseline 例外计入，无 AI 建议分 | BOW-834/835/837/840 |
| 档案小象限 | `referencePosition` | talent 当前有效确认分计算；只给参考分类或资料不足/未知，档案另有 `bonus`（领导力或开放性各自均值 ≥ 4，不改象限），不设新阈值，无正式位置 | BOW-837/840 |
| 校准轨迹、档案版本与变化 | `calibrationHistory / versionsAndChanges` | talent 盘点冻结未接入；固定 `not_connected` | 后续盘点冻结链路 |
| AI 推断 | `aiInferences` | 独立块，不冒充人工结论；`category` 随输入内容定类，导师变体只能是 `evaluation` | BOW-835/837/840 |
| 时间线、参与项目 | `timeline / projects` | 关键事件、自述、历史量表三种条目：`label`（界面来源标签）与 `category`（授权类别）分开，事件带逐分来源与证据冲突；项目含角色、方式、起止；均为已授权入口 | BOW-837/840 |
| 所有引用角标展开 | `sourceReadInput / sourceReadResult` | 入参只有 fragmentId + originalVersionId（`toSourceReadInput`），结果含 `originalTitle`、可空的 `recordedByName`；每次核对关联及当前权限，不整件返回 | BOW-834/835/837；播放 URL 由 BOW-873 后续接入 |
| 三个页面的结果包络 | `peoplePage / workbenchPage / personPage` | `ok` / `forbidden`（档案另有 `not_found`），拒绝不带 message 与人名；返回前须解析 | BOW-837/838 |

状态规则：已接入的事实块 `ready` 必有非空 payload；`empty` 仅表示权限范围内确无记录；`insufficient_evidence` / `unknown` 带原因而无数值。来源读取失败沿用 `validation_error / forbidden / not_found / conflict`，不得伪装空状态。加载中是前端本地状态。未接入区块只含 `{status: 'not_connected'}`，不携带伪计数、数组或业务记录。

角色规则：档案摘要、能力谱、时间线、项目供管理者、范围内 HR、所带学员导师读取；象限位置、校准轨迹、版本变化及 `management-observation` / `restricted-evaluation` / `performance` / `quadrant` 类内容仅当前获权的管理者/范围内 HR（导师变体的 `category` 只能是 `evaluation`）。导师严格变体不含这些字段，也没有 hiddenN；系统管理员无业务成功变体，查询入口拒绝后使用现有通用权限提示。AI 推断只可来自该角色已授权来源。schema 是边界校验，不替代服务端授权。

列表按授权 → 姓名/岗位检索与团队筛选 → teamName、name、id 稳定排序；本次有界演示目录不分页，total 恰为可见筛选结果数。排序由 BOW-837 查询实现并测试，合同不重排数据、不提供 score 或校准变化参数。ID tie-break 仅确保重名稳定，非人才排名。

来源位置为 document（可选 page、必填 paragraph）、spreadsheet（sheet、cell）、recording（startMs、endMs）或 snapshot_field（fieldPath，可选 originalLocation）。按 BOW-834 已定方案 A，固定原型作为 prototype_snapshot 原件登记，片段定位到 events[id].srcs[i] 或 events[id].act；originalLocation 仅为原表位置说明，不伪装单元格坐标。来源详情必须区分 sourceCategory=original / prototype_baseline，后者要求 demo=true，携带原件 displayNotice「原型基线 2e51b50，评语按原意压缩」，不得冒充原观察表。快照 commit/blob 由 originalVersionId 对应版本承载，不逐位置重复。无版本/位置不成引用，不用合成夹具补齐真实链路。录音播放 URL 在 P0 完全省略，不能包含永久公开地址或存储 key。读取输入不接受调用者 role。

前端开发夹具：`tests/fixtures/p0-contracts.ts`，只含 `test-*` 标识和明确合成描述，涵盖三角色、ready/empty/insufficient_evidence/unknown/not_connected、来源拒绝。不得作为生产 fallback。测试：`src/contracts/p0-contracts.test.ts`；不改变工程共享配置与覆盖率排除。

BOW-837 只读取确认表，演示环境的 prototype_baseline 与正常确认分一样参加能力谱和参考位置；原型 AI 建议及资料不足不计入。这个合同不决定授权或正式导入许可，正式入口拒绝 prototype_baseline 由 BOW-834 保证。前端负责人需评审新增快照位置、来源类别与提示的展示；当前尚无该验收证据。


本次恢复与清单的差异以版本 Y 和更新裁决为准：

- R3.1 已按 10/26 决定让管理者也有 `record`，与 Y 的「记一件事」一致；不因 DY-16 的实时录音禁入而移除该文字记录入口。
- R4.1 的受限历史不再一律映射为 `performance`。结营沿 #284 的 `restricted-evaluation`，原 `kind`、量表、分值和来源保持；当前源策略、页面投影与模型输入仍同源核权。导师响应严格只接受 `evaluation`，本片不补造节点评价关系，899 的同节点正向授权仍待其真实适配。
- R0.7 的证据冲突沿 Y DY-09：同一事件、维度的有效确认分差至少 2 才为冲突；不把任何不同分值都判为冲突。冲突组不进入速览线索、能力谱或参考位置。
- Y 的工作台命名、排序和角色边界优先：中文拼音排序、系统管理员整页拒绝、无隐藏数量；旧清单不恢复版本 X 的导航或管理者处理型首页。

读取适配不补缺失业务事实：`level=null`、`jobTitle` 沿既有「职位未接入」占位、组织路径当前单级；参与人角色/本人角色省略；人工结论缺形成日期时 `unknown`，不拿事件日冒充；`recordedByName=null`，不借事件记录人充当原件记录人；维度暂按组和 id 排列，等待目录顺序。R2.3 待确认 AI 事件排除、R4.1 显式入库类别与团队记录者正向集合、R0.1 页面包络/真实 UI、R3 工作台活动等仍由 834/837/838 与实际消费者完成，不以本片契约测试或形状适配当成整链验收。

## BOW-844 记事与评分复核契约

`src/contracts/record.ts` 定义整理草稿、确认、改分和五秒撤销的输入输出；`review-queue.ts` 定义两类评分复核与带理由校准。冻结位置复核保持 `not_connected`，不作为评分校准成功条目。

本切片只交付契约与合成测试，不创建业务页面或写入服务。`/record` 的读写与 UI 由 BOW-845、BOW-846、BOW-847 接入；`/queue` 由 BOW-848、BOW-849 接入。两路当前继续返回 404；后台处理进度复用 jobs 契约。
