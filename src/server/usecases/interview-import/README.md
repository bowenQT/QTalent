# BOW-906 面评导入决策与隔离解析

本目录提供两个内部能力：纯函数 `planInterviewImport` 生成逐行导入决策；`parseInterviewPdfIsolated` 在可终止的 Node 线程里执行确定性 PDF 解析。没有数据库、原件下载、模型调用、队列注册、HTTP/Next 路由或档案写入。`planned` 不是入档回执，解析返回结果也不是人工确认。

## 原分支历史输入与净差

| 输入       | 固定提交                                   | 实际消费                                                                         |
| ---------- | ------------------------------------------ | -------------------------------------------------------------------------------- |
| 900 / #257 | `624e05b26b97a6ed5684f0d11637ea387301f8a5` | 实际解析器、原生 DTO、原文姓名、版本化页文字/UTF-16 范围及局部 PDF 预算          |
| 899 / #262 | `d5cf82fa264e022b8e4c928b008461e98c53293d` | 直接调用当前节点 HR 授权；相对原输入96fa只有X1的两行合成夹具补丁，未复制授权代码 |
| 897 / #254 | `0b20a913621121848219e0966ba4bf4844d1bdb3` | 实际历史面评来源、待核对项和关联命令 schema                                      |
| 896 / #251 | `9533f64306ed68a6c2d2966474ef6d89033a5e31` | 化名目录、候选人清单、三模板和异常 PDF                                           |

原决策三文件在 `8ed4adf4baa24633a7d96009213fbecfe43dc790`；本阶段未改 `plan.ts` / `plan.test.ts`，只新增四个 `pdf-*` 文件并更新本说明。沿原分支普通合入固定依赖后，本阶段基线为 `5d36b0479fd39399a5a176116f812efd77855d79`。上游文件只消费已交付提交，不把继承 diff 算本卡实现，不 rebase/强推。

## 逐行决策

输入是将来服务端在事务锁后重新读取的事实快照，**不是请求 DTO**。账号、时钟、HR 逐行确认、招聘记录、目录任职、既有导入、canonical 来源与待核对项须由真实适配器加载；不能缓存 `planned` 或信任客户端角色/身份/状态。

- 当前范围内 HR、面试节点与主体通过899才给计划。员工、评价人、管理者及系统管理员不借此获得面试分。
- 先按观察姓名、职位编号、面试时间严格匹配招聘记录；三项不唯一或身份缺失进入 `unknown_interview_candidate`。入档仍须 HR 当前行版本确认与真实任职，面试通过不等于录用。
- 三项唯一匹配的淘汰、待入职、放弃录用在 HR 认人前即跳过，包括未绑定目录人员和目录已有同名人员的淘汰申请；`hired` 标记仍必须有该人已经开始的目录任职。没有新加“曾离职即从未入职”的产品规则，当前访问权限独立判断。
- 原生维度选择、评级、职级、面试结果、明确不适用和逐字段出处原样保留；未识别或缺必填元数据保持未就绪。不换算正式维度分，不生成象限、匹配、值得关注或模型输入。
- 面试官与导入账号/人员分别署名；导入不等于面试官在本系统确认，即使两者是同一个人。
- 未知/重名面试官产生897待核对提案，不能入档或新建人。仅关联已有目录人；恢复核对原批次、行、节点、材料、原件、片段/范围、原观察名及revision。无命令/延期保持待核对，当前撤权不恢复。
- 重复身份为候选＋面试时间原文＋面试官＋模板；JSON元组摘要避免分隔符碰撞，恢复同样检查重复。未实现数据库唯一性/CAS，不把纯函数当作并发保证；没有猜测正式模板的日期/时区标准化。

## 真正的 Node 线程边界

内部调用示例（原件已经服务端授权，读取过程也必须有界）：

```ts
const outcome = await parseInterviewPdfIsolated({
  bytes,
  options: { positionKind: 'unknown' },
  budget: { maxInputBytes: 1024 * 1024, maxOutputBytes: 1024 * 1024 },
  signal,
});
```

`status:'failed'` 只有安全原因，不含成功 DTO、诊断或原文。`status:'parsed'` 表示线程返回了原生900结果，**内部仍可能是 rejected / needs_manual_input**，必须继续检查并交逐行决策，不直接入档。

- 复用主线 Node24 + tsx 源码运行方式：`Worker(new URL('./pdf-worker.ts', import.meta.url), {execArgv:['--import','tsx'], ...})`。无需新包/编译配置；实际 Node 线程已测试，不代表 Next 打包、服务注册或部署已验。
- 输入预算必填、正整数、最高32MiB；超限在复制/启动前拒绝。仅复制精确视图，传递独占 ArrayBuffer，不转移调用者内存或 Buffer 池相邻内容。worker 内部再校验输入。
- 输出预算必填、最高2MiB。worker 先校验固定 DTO 并计算 UTF-8 字节数，再分配/转移结果；父线程在解码前核预算并严格校验消息/结果。stdout/stderr 私下消费、计入预算，不写宿主日志。不把源码、URL、账号或凭据放入消息；线程环境为空。
- 默认/最高60秒，V8旧代堆16–256MiB（默认256）、栈4MiB。取消、超时、异常、无结果退出、坏消息及正常结果都等待 `terminate()`；清理定时器/监听器，只选一次终态。晚到结果另核单调时钟，不能因计时器延迟变成成功；终止失败返回 `termination_failed`。
- 这不是 OS 安全沙箱。JS堆限制不覆盖整个RSS、ArrayBuffer或原生内存，预算也不是产品上传限额。原件读取流/任务并发仍须真实调用者限制，不能等已读完大文件才考虑读取预算。
- 新900在读页前限制200页、单图200万像素，并拒绝失败/未完成的绘图流；`resource_limit` 安全分类跨线程保留。没有总图片解码量预算，不把局部预算冒充外层隔离。

## 姓名和出处的边界

900已经提供明确原文姓名；没有已证实的职位编号，`positionNumber` 仍为null。未接生产招聘记录和HR确认读取，所以真实缺字段仍应未就绪，不能拿演示职位号代替。

实际线程保留900的 `pageTexts`、提取版本、摘要及真实UTF-16 `textRange`；测试逐一切回页文字并通过897严格PDF定位，额外box被拒绝。本层不从bbox生成offset，不将全份pageTexts传给前端/模型。后续必须将文本/摘要/片段绑定同一受权原件版本，生产canonical来源与原件读取尚未实现。

原决策正例使用897独立合成canonical来源及自建 `DEMO-JOB-01`，不证明896 PDF已持久化、生产身份已匹配或已有档案来源映射。缺canonical来源或直接传bbox返回未就绪；材料ID必须单独提供。

## 验证与尚待工作

Node24.21.0 / pnpm11.25.0；本工作区 `pnpm install --frozen-lockfile --ignore-scripts` 成功，未批准构建脚本、未改共享配置。使用同锁安装的二进制运行：

```sh
node node_modules/vitest/vitest.mjs run src/server/usecases/interview-import/pdf-isolation.test.ts src/server/usecases/interview-import/plan.test.ts --maxWorkers=2 --coverage '--coverage.include=src/server/usecases/interview-import/*.ts' '--coverage.exclude=src/server/usecases/interview-import/*.test.ts'
```

新固定组合88/88通过：原决策56项＋隔离32项。实际线程覆盖三模板等价、真实页引用、预取消/运行取消、超时/晚到消息、输入输出/诊断预算、损坏PDF、200/201页、超大图片、失败绘图流、实际throw/无结果退出、坏消息及终止失败。每项清理后核线程ID=-1；故障脚本只在测试侧创建真实线程，没有替换正常/损坏PDF路径的解析器。受控移除terminate会检出线程仍存活；已恢复相同源码，并在新组合重新通过。

本卡四逻辑文件定向统一行97.02%（163/168）、分支94.20%（130/138）、语句96.73%、函数93.54%；没有排除worker入口。V8不把线程内顶层postMessage计入宿主覆盖率，这些行仍报未覆盖，实际线程行为另有运行证据。全仓类型、范围lint、全仓边界通过；精确受检head及其他检查以PR最新记录为准。

后续入口责任见 [#248/6548326080](https://github.com/bowenQT/QTalent/issues/248#issuecomment-6548326080)，900稳定输入见 [#229/6548629274](https://github.com/bowenQT/QTalent/issues/229#issuecomment-6548629274)。worker应用注册/唯一producer/公共出口仍X1；历史分类、独立署名、节点与档案投影及生产持久化须另开明确窗口。本层无写库能力，失败无入档计划，不把这些事实当数据库零写入验收。

正式模板字段/维度/选项/版式按所有者裁决延期，当前只支持合成模板；这不是本轮合成模板交付的阻断理由。职位编号的权威招聘记录仍缺，不能拿测试值补齐。GitHub blocked-by全部（899、900、897、873、843、904、845）真合main、实际接线/权限/原件/模型分类验收前，保持Draft/整卡未完成，不ready、不关闭、不部署。

## 本轮：最终897核对与行只读栅栏

本轮仅改 plan.ts、plan.test.ts、新增 review-state.ts 及本说明。原 c1822464 的跨工具通过只覆盖旧计划与隔离线程，不覆盖这些增量。普通同步 main 27d7da28b887d3e0b8043a7ee3cdd915e67c2d56 在17个共享/节点授权文件冲突，已立即 abort；精确路径和 X1 请求见 #248/6557917011。未选择旧 contract blob。本轮运行验证通过临时只读解析映射，直接加载该固定 main 的实际 material-review.ts、sources.ts、authz/index.ts、authz/evaluation-node.ts 及其同树依赖；未复制 schema 或改项目配置，不代表原分支已完成共享同步。

- 未确认、缺字段或未绑定目录的候选进入真正的 unknown_interview_candidate，不能按 unknown_person 处理。身份、任职和“姓名＋职位号＋面试时间”的严格匹配仍保留；手工关联也不能补出职位号。keep_original_only 只保留原件、跳过该行，defer 不恢复。候选与面试官各有独立 item 身份。
- InterviewRowSnapshot 是未来原生事务锁后读取的服务端事实，不是客户端请求或新实现的生产端口。必须提供同批次/行/节点/材料/原件身份、当前行修订、真实导入或已审计撤销状态、当前账号/HR授权期次绑定、whole-original/HR 权限、完整 scope subjects（仅真实已核实为空才可[]）、hidden 布尔及目标 blockers。缺字段/null/未知返回 unavailable/not_ready，不补空集合、allow 或未导入状态；已知 subjects 逐人再跑899当前权限。
- imported 行在重新解析或修改关联前即只读：普通重复返回同一 evaluationId，核对命令 conflict。仅有当前原生导入撤销审计和新行修订仍不够，更正还要当前行版本的真实 HR 逐行确认（confirmedForRowRevision、confirmedCandidateId、confirmedInterviewerId）。不自动重用旧关联，不在撤销后把旧核对 item 重建成 revision 1。
- 恢复要求原 pending 问题及命令与已提交 resolved item、最终 resolution receipt 一致：行修订、item 修订、语义、source 和原始观察名都核对。incoming command 不是已提交决定；回执 resume 不是权限。当前目标 blockers 非空不整理，未知身份不计分、不入档。
- projectInterviewReviewState 只投影当前可见的已解决项；已导入时 undo 显示 interview_row_imported。过期权限拒绝、当前不可见关联整项隐藏，只返回 hasHiddenContent 布尔，无隐藏姓名、ID 或计数；待核对重放也重新过滤候选，并使用当前目录名。
- consumeInterviewUndoReceipt 只校验真实已提交撤销回执，不执行撤销。要求当前行未导入、当前 resolved.undo 可用、命令版本与原件/行一致、回执 pending revision+1、auditId、resume:null；当前不可见关联或候选拒绝。dependent_draft_confirmed 保持阻断，不把AuthzContext业务钟用于审计/撤销时限，不改846的5秒墙钟规则，不伪造审计、失效列表或恢复 job。

### 必需原生读取/接线（当前均未提供）

1. 在本域后续事务适配中，用同一个原生 row/source 锁读取真实行状态、当前完整原件权限/subjects、当前 HR 确认与其行修订、pending/历史 resolved 决定及真实审计/回执、全部当前目标 blockers。原件历史/上传 getter 不提供这些授权；未知行范围无法由899已知 person API推出，缺真实读取保持 unavailable。面试官还需独立的当前工作人员目录判定，不能把任意同名员工当面试官。最终 schema/迁移和公共入口交 X1。
2. 持久导入 CAS、逐行唯一性、重复身份索引、原量表/独立署名与来源写入、审计和同事务回执尚未实现。当前 planned 只是决策值，没有写入历史评价，也不是零重复写的数据库验收。
3. 实际 resolution/undo handler 仍须在同事务完成原生双 revision CAS、审计、未确认草稿失效和 pending/resolved 投影；current resolved/audit/receipt 必须由存储加载，不能由客户端提交给这些私有校验函数。当前函数没有成功写接口、没有虚构生产 port 或 SQL。
4. 原件通过873核版本与当前读取，再将900 pageTexts/摘要/片段绑定 canonical 原件。生产 worker 的编译入口、依赖供应和 Next 打包后运行仍待 X1，不把源码 tsx 线程实测当生产打包证明。
5. 本片不实现843模型分类、904管理观察、845整理或846确认；原评语分类仍需经当前权限/敏感属性过滤的固定输入，AI 分类不能冒充人工结论。本轮无新模型/供应商请求。
6. 档案来源 projection 仍须和837明确对接 src/server/queries/person-data.ts 中 row.sourceCategory / row.kind / source fragment 与节点主体映射，消费906实际历史评价和署名；不放宽当前未知历史类型清空 subjects 的保护。真正写入/来源分类未冻结前，不造新的 sourceCategory 值或空来源作成功。

### 合成材料的权威字段缺口

实际900三模板能提供带定位的姓名与面试时间，positionNumber 固定 null；896 candidates.json 只有候选身份/目录身份/录用状态/材料文件，没有职位号或面试时间字段。当前正例的 DEMO-JOB-01 仅是隔离算法夹具，不进入生产或冒充PDF提取。

最小建议：由权威招聘记录按 candidateId 提供 positionCode、原面试时间及记录身份/版本，再与 PDF 姓名/时间和当前 HR 逐行确认核对。缺该记录仍待核对或未就绪；不得从文件名、默认职位号或手工选人推导职位号。本轮没有改为“姓名＋时间”匹配，正式模板延期不影响这项缺口的如实披露。

### 本轮验证（精确私有源码＋固定外部输入）

- RED：原 c182 生产代码＋新增3反例，读取最终 main27d 实际897契约，3/3失败、原56项未选中。反例分别证明未知候选没有真实待核对、已导入换面试官仍 planned、未提交命令即可恢复。日志 /tmp/qtalent-q906-red.log。
- GREEN：项目既有 Vitest，以 /tmp/qtalent-q906-final-contract.config.mts 只读映射上述固定输入，执行本目录全部测试、maxWorkers=2、testTimeout=20000、coverage.include 本目录全部自维护逻辑（只排除测试文件，不排除 worker）。147/147通过：逐行/核对115＋原实际线程32；五逻辑文件行96.44%、分支94.24%，语句96.41%、函数96.22%。覆盖目录 /tmp/qtalent-q906-final-coverage。
- 框架时限说明：一次在本机11核、load约39时，原未改的 termination_failed 用例撞到 Vitest 默认5秒，146过/1超时；保留 /tmp/qtalent-q906-default-worker-timeout.log。上述GREEN仅把测试框架时限改为20秒，生产预算、真实线程、故障注入和断言均未改，不称默认CI因此已绿。
- 类型同样区分输入：项目原分支默认 tsc 仍有21诊断，因旧897没有新增kind/已解决/undo等导出及最终回执字段。TypeScript 编译器只读映射最终897/899后，本目录0诊断；另有6条旧继承夹具的 originalTitle/recordedByName 诊断（staffing.fixtures、standard-iteration.fixtures、SourceCite.test），不在本卡修改。证据 /tmp/qtalent-q906-type-proof.json。没有据此宣布全仓或最终main类型通过。
- 本目录ESLint零warning、Prettier、项目架构边界、净diff检查通过。没有完整 check/integration/e2e/visual、真实PG、模型/供应商/原件网络调用或新服务/subagent；未持heavy/WeCom槽。默认完整组合、CI和实际持久导入待X1共享同步及原生接线后复验。

## 所有者新裁决：认人之前跳过非录用行

依据 [#248/6560666796 第1条](https://github.com/bowenQT/QTalent/issues/248#issuecomment-6560666796)，本次只调整私有决策顺序、测试与说明。旧2fc17f5的审查通过不覆盖此增量；不是修改907界面、持久化状态或撤销合同。

| 当前服务端事实                                                | 逐行决策                                                                     |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 当前HR/整份原件/已知主体权限不通过                            | forbidden；不泄露招聘状态                                                    |
| 行已导入                                                      | 保持duplicate或命令conflict，不用跳过覆盖已有评价                            |
| 姓名＋职位号＋面试时间唯一，状态淘汰/已发offer未入职/放弃录用 | 未确认、无目录绑定也返回skipped/not_hired，无入档计划或resume                |
| 三项缺失、无匹配，或多条匹配且未经当前行HR确认                | 仍待认人；不自动跳过或入档                                                   |
| 多条匹配经当前行HR确认及申请ID消歧                            | 按确认申请继续：非录用跳过，hired核任职/面试官等栅栏；已提交核对还须真实回执 |
| 唯一hired                                                     | 继续当前行HR确认、目录任职、面试官及其他栅栏，不凭面试通过入档               |
| 已审计撤回后重新处理                                          | 重新读取当前招聘事实；非录用仍可跳过，入档则须新行版本确认                   |

非录用的唯一三项匹配不要求先补齐评分、面试官、评语；入档仍要求完整解析。未解决的候选/面试官提案不能迫使HR先认人再跳过；其原件/行/观察名仍须一致。提交的核对命令不借跳过冒充成功回执，仍走原有版本与已提交决定校验。

跳过是可重新计算的决策，不删除原件、不改写候选、不产生永久排除标记。测试证明同一输入不被修改，下一次加载新事实可重新计划；**跳过持久状态、撤回审计/CAS与重新排队仍须原生事务接线**，本片不把纯函数等同这些实际写入已经存在。900仍无权威职位号，未伪造其生产输入。

本次验证使用实际原分支（X1已在2fc17f5普通整合main325de93），不再用临时合同解析映射：Node24.21.0、pnpm11.25.0。30项新裁决用例中，最初21项在旧生产实现下10失败/11通过；另3项证明未识别评分/面试官/评语缺失仍阻挡跳过，修复前3失败。最终本目录177/177通过（145决策/回执＋32实际隔离线程），统一行96.27%、分支94.35%。命令为 `pnpm exec vitest run src/server/usecases/interview-import --maxWorkers=2 --testTimeout=20000 --coverage '--coverage.include=src/server/usecases/interview-import/*.ts' '--coverage.exclude=**/*.test.ts'`，框架20秒不改变生产预算。实际线程结束仍断言threadId=-1。全仓typecheck、format:check、本目录ESLint、架构边界与diff检查通过；未跑完整check/PG/e2e/visual或供应商调用，无heavy槽/服务。新head的远端CI与Claude增量审查另以PR回执为准。

B1 首轮修复：三项唯一仅约束认人之前的自动跳过，不再阻断 HR 已确认的重复三元组。确认仍要当前行 revision、精确 candidateId，以及已提交核对选择的 personId 一致；同一 candidateId 仍有多条结果、旧确认或缺真实回执均不能入档。对应907出口：未确认重复行为 needs_review；合法确认后 hired 可 planned、非录用为 skipped/not_hired；candidate_match_unconfirmed 只留给已选人却无法匹配当前合法申请的失败情形。
