# 固定演示证据导入（BOW-834 方案 A）

本实现基于已合入 main 的 schema PR #83（25af415）。以 Linear [已定评论](https://linear.app/bowenzhong/issue/BOW-834) 与 [SDD/TDD](https://linear.app/bowenzhong/document/2a841c4d4090) 为合同。本目录不提供读取接口、授权策略、评分确认或冻结用例；代码和自动测试结果不代表真实业务验收。

## 来源与映射

加载器只执行固定 2e51b50 的 data-xe6.js、data.js，并逐文件校验 SHA-256 和 Git blob SHA；不执行 store.js。两个文件分别登记 prototype_snapshot 原件及版本，保留路径、commit、blob 和摘要。字段在 XE6 与最终 SEED 中值相同则指向前者；最终新增或改变的字段指向 data.js。来源链终止于原型求值快照，不冒充原观察表或逐格作者。

每个 srcs[i] 建 snapshot_field 片段，原 loc 仅保留为 originalLocation 展示标签。普通评分提取 note 的“引用「…」”正文，仅去掉引文末尾省略号；先唯一匹配显式 src.quote，再在没有来源匹配时用 act。固定快照有 23 条文字同时出现在两处，来源优先得到已定的 442 个 srcs 与 116 个 act 定位；多来源匹配或没有匹配会给出仅含记录 ID / 缺字段的错误，不猜位置。

没有 quote 的历史 src 字段保存精确 JSON 序列化文本，并标为快照字段。分歧评分人和 unknown 使用 scores[i]/raters[j] 的精确字段，不补造原表引文。importSnapshots 保存全部 398 个事件内容；不导入 store 推导的档案、象限、参考位置或冻结快照。

维度分均引用 rubric-v1，按维度和值查唯一锚点。baseline 确认的 confirmedAt/modifiedBy 保持 null；未知评价人保持 null，不使用事件日期、导入账号或 0 代替。AI 建议独立保留、模型标“原型基线”；分歧按评分人分行，原 bigGap 标记形成 score_gap 复核。

固定数据的验收基数：277 条观察、558 条 scored 确认（556 + 分歧2）、1 条 unknown、4 条 AI 建议（2 个待确认项 + 2 个原 AI 值）。10 条观察 act 为空，其中9条有13个评分项；只对明确的演示事件保留空 behavior，不从 res/title 补造。21 个非单人历史事件保留 individualContribution 缺口；历史量表保留一次，不复制个人维度分。

## 历史 kind 的精确有限集合

这些是本 mapper 对当前固定快照的实际输出，不是新增产品分类，也不保证未来来源只有这些值。读取方必须显式映射已知值；未知历史类型及相关共享片段仍沿既有权限保护，不能靠关键词降敏。

| kind 原值   | 条数 | 语义                                                          | ruleVersionId | sourceCategory     |
| ----------- | ---: | ------------------------------------------------------------- | ------------- | ------------------ |
| 训练营周评  |  242 | 原观察 sum 的“本周总结”三档；period 保留原 week，不换算维度分 | xe-weekly-v1  | prototype_baseline |
| 结营评审    |   93 | 保留原结营评价量表                                            | null          | prototype_baseline |
| MS 路演评审 |   19 | 保留小组级路演原量表；不生成个人分                            | null          | prototype_baseline |
| 奖项答辩    |    9 | 保留原答辩量表；不复制团队分                                  | null          | prototype_baseline |

后三类 kind 原样来自 histType；周评固定使用“训练营周评”。历史总数为 363（121 + 242）。参与人只采用事件明确列出的 people，不从项目当前成员或 store 反推。

## 两条持久入口

importDemo 是显式服务端 seed 路径。函数自身通过 getEnv 读取运行域并拒绝 production，CLI 检查不是唯一门禁。输入不能通过 demo、mode 或 APP_ENV 改变运行域。函数重新读取校验后的固定源，核对 input.raw 完全一致后只从校验结果重建写入；可变的 raw 或来源 owner 不能证明固定 Git blob 的内容。缺少已准备的固定缓存时失败，不退回工作树或可变 payload。

importEvidence(db, input) 是内部正式完整证据批入口，实际解析后进入事务写入；没有新增 HTTP/Action。顶层和每条写入记录均 strict 解析，不先 strip 客户端控制字段。拒绝 prototype_baseline、prototype_snapshot、snapshot_field、demo=true 及无正式评价人/修改人的确认。全部版本、片段、事件与关联必须构成同一批的完整原件链，复合 ID 采用无歧义元组键；它不是后续“给已有事件确认分”的用例。实际人物必须为非 demo，实际规则必须已 published，不能只相信 payload 的 sourceCategory。

正式调用方仍负责当前资源授权、原件真实性及可见范围；导入校验不是授权 API，也不允许通过任意 SQL 绕过。后续确认、修订和来源读取各由责任卡接入。

## 事务、重跑与碰撞

基础人员/账号/项目与全部证据在一个 PostgreSQL 事务提交。按表批量写入；ON CONFLICT 后若未全部插入，会在同一事务读取并核对实际冲突行，包含并发胜出者。缺 incoming ID 的其他唯一键碰撞或不相容的不可变来源也失败，不静默少导入。

真实人员 demo=false、不同账号邮箱/绑定、真实已发布规则或不相容锚点/版本都使整批失败。已存在 demo 人员的名字、项目名称等用户编辑，以及已有密码/撤权字段不会被 seed 覆盖；不可变的证据和规则不允许悄悄改写。晚阶段写入失败回滚全部本批插入，不留下半套账号或原件。

只在明确的非 production 演示库执行 pnpm db:seed，环境变量入口沿用仓库 deploy/README.md；先 pnpm reference:prepare，数据库迁移是独立显式命令。本 mapper 不生成迁移、不重置库、不调用供应商、不打印原文或凭据。恢复保留历史数据，不自动 DROP 生产表。

## 验证边界

SDD/TDD 回归覆盖计数与字段定位、特殊评分/原量表、固定源和 owner 篡改、正式入口控制字段/真实引用核验、复合键歧义、身份/账号/规则碰撞、幂等与全事务回滚。集成测试只创建和清理本次随机 loopback _test 库。最终命令、覆盖率、浏览器和 CI 结果对应 PR 的实际受检 head；schema 的旧结果不充当 mapper 验收。
