# 目录展示事实续作（BOW-834）

本片对应所有者 #248 评论 6560666796 第 3 条新增范围，不重定义此前证据评分模型与 X2 的验收记录。

当前只有输入校验、回填计划和目录展示纯规则，**尚未接原生持久化或页面**。schema、正式迁移、公共出口与 person-identity 接线请求见 #248 评论 6560802470。仅这些文件通过测试不能代表职位/职级/组织层级已上线；不建立无消费的独立 Ready PR。

## 事实与未知

`projectDirectoryProfile` 只消费服务端权威目录行，调用方须先沿既有人员档案授权门禁过滤。它不授权，不根据人员名字、评价角色、项目组、训练方向或毕业年份推断字段。

- `jobTitle`、`jobLevel` 为准确输入或 `null`。未知不变成空字符串，也不填示例值。
- `parentId=null, hierarchyKnown=true` 表示经确认的根；`hierarchyKnown=false` 表示旧库未接层级。链上任何一级未知，完整 `organizationPath` 都是 `null`，不把局部路径充当全路径。
- 已知链断裂、自环、循环、重复身份、空白组织名均报错，不返回貌似合理的前缀。
- `demo` 沿实际人员行保留，供调用方标示演示。

字段形状是交给 X1 的最小建议，最终须适配其固定 schema，不由本片生成 SQL。现有全局人员授权、组织归属与人员状态不变。

## 化名目录输入与升级

`src/server/db/seed/directory-profile.ts` 只解析显式 `directory_demo_profile` JSON：`version=1`、化名 people（id/name/organizationId/demo=true/jobTitle/jobLevel）以及明确组织父子行（id/name/parentId）。组织输入必须自足、无环；空组织列表允许只补人员字段，不暗示任何新层级事实。

`readDirectoryProfileSeed(root, source)` 的 `source.relativeFile` 和 `source.sha256` 必须由受审服务端组合固定，不能来自 HTTP、客户端或任意操作员请求。校验文件摘要后解析；没有默认源，也不读取私有资料目录。当前没有获准的实际补充数据文件与摘要，不能据测试样例执行导入。

`planDirectoryProfileBackfill` 供后续 native writer 在同一事务锁住真实行之后调用：只给 demo 人员补明确空值，准确核对名字与组织引用；源 null 不删除已有值，已有非空值冲突整批拒绝。组织只给已存在且名称一致的行补未知层级，不创建/重绑人员、账号、授权，也不覆盖已确认父关系。相同输入重跑产生空计划。真实事务、并发、审计及升级后的权限读取仍待实际 schema/native writer 验证，纯计划不能替代它们。

## 当前合法来源缺口

已合原型的学生 `level` 是毕业届次，`title` 有训练方向；导师/助教字段有项目角色。原型 ORGS 明确按训练营课题分组。这些都不能整列转成职级、职位与真实组织树。需要经批准的化名目录补充事实与去除真实个人资料的真实组织父子表，不能读取 docs/sources 或猜值回填。

页面与 911/912 消费须由共享窗口接现有授权过滤后的 identity，完整字段可用才替换“未接入”。未知仍明确缺值；现阶段没有 PG、部署或供应商调用证据。
