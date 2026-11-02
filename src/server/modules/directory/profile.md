# 目录展示事实续作（BOW-834）

本片对应所有者 #248 评论 6560666796 第 3 条新增范围，不重定义此前证据评分模型与 X2 的验收记录。

已实现目录 schema、严格输入、回填计划和原生事务导入，档案通过既有权限门禁消费持久字段，显式 seed CLI 接固定演示入口。X1 共享结构与消费分别为 5bd7b2a、c07ed02；真实 PG 与权限回归已验证，正式迁移仍由 X1 按游标交付。受控临时迁移的验证不代表正式迁移已发布，也不代表已部署。

## 事实与未知

`projectDirectoryProfile` 只消费服务端权威目录行，调用方须先沿既有人员档案授权门禁过滤。它不授权，不根据人员名字、评价角色、项目组、训练方向或毕业年份推断字段。

- `jobTitle`、`jobLevel` 为准确输入或 `null`。未知不变成空字符串，也不填示例值。
- `parentId=null, hierarchyKnown=true` 表示经确认的根；`hierarchyKnown=false` 表示旧库未接层级。链上任何一级未知，完整 `organizationPath` 都是 `null`，不把局部路径充当全路径。
- 已知链断裂、自环、循环、重复身份、空白组织名均报错，不返回貌似合理的前缀。
- `demo` 沿实际人员行保留，供调用方标示演示。

字段形状已由 X1 固定 schema 实现，作者不生成 SQL。现有全局人员授权、组织归属与人员状态不变。

## 化名目录输入与升级

`src/server/db/seed/directory-profile.ts` 只解析显式 `directory_demo_profile` JSON：`version=1`、化名 people（id/name/organizationId/demo=true/jobTitle/jobLevel）以及明确组织父子行（id/name/parentId）。组织输入必须自足、无环；空组织列表允许只补人员字段，不暗示任何新层级事实。

`readDirectoryProfileSeed(root, source)` 的 `source.relativeFile` 和 `source.sha256` 必须由受审服务端组合固定，不能来自 HTTP、客户端或任意操作员请求。校验文件摘要后解析；没有默认源，也不读取私有资料目录。固定补充源为 `directory-profile-demo.json`，`DIRECTORY_PROFILE_DEMO_SOURCE` 固定其摘要；`importDirectoryProfileDemo(db, root)` 是显式服务端入口，不自动运行。文件有 93 名既有化名人员，`peopleProvenance=synthetic_demo`，职位/职级标演示；值为本次独立合成，不由原型方向、角色或毕业年份推导。组织归属逐项保持原有 ID。organizations 是定稿原型 Y `ORGS` 的 26 行父子关系（id、名称逐字相同，`parent` 原样作为 `parentId`，`group` 原样作为 `isGroup`；分组节点「人才项目」「职能」是已确认的根），由测试逐行核对原型，不另造组织。

`planDirectoryProfileBackfill` 供 native writer 在同一事务锁住真实行之后调用：只给 demo 人员补明确空值，准确核对名字与组织引用；源 null 不删除已有值，已有非空值冲突整批拒绝。组织只给已存在且名称一致的行补未知层级，不创建/重绑人员、账号、授权，也不覆盖已确认父关系。相同输入重跑产生空计划。原生 writer 使用 RC 事务，按稳定 ID 依次锁组织、人员行，再计算计划和写入。真实并发、晚失败回滚、production 拒绝、旧形状行兼容与当前授权投影已经在受控迁移组合下实跑；X1 另验了旧行实际升级。该离线显式导入不新增账号/权限，也不提供 Web 动作。

## 组织层级的来源与显示差异

已合原型的学生 `level` 是毕业届次，`title` 有训练方向；导师/助教字段有项目角色。这些不能整列转成职级与职位，职位/职级已按所有者授权独立合成。组织层级不读取 docs/sources：演示人员归属的组织本身就是原型 `ORGS` 的行，层级沿用原型给这些组织定的父子关系。这是来自定稿原型 Y 的演示组织树，名称照原型，不是从 docs/sources 读取的公司真实组织表。导入后 26 行全部 `hierarchyKnown=true`。

`person-identity` 通过授权过滤后的 identity 消费：职位/职级来自原生字段；`teamPath` 是完整组织路径（例如「人才项目 / XEngineer 第六期 / 线索雷达」），`orgPath` 按原型 `store.orgPath` 的规则显示：上级加本组织，跳过分组节点（`is_group`），最多两级（例如「XEngineer 第六期 / 线索雷达」「人力资源部」）。链上存在未知层级时两者都显示「组织层级未接入」。分组标记与父关系一起由目录导入写入，未知层级的行不能是分组。911/912 若有独立适配，须继续消费同一授权后事实，不能维护第二套值。

显式 CLI 在原 `importDemo` 成功提交后调用 `importDirectoryProfileDemo`；这是两个顺序事务。第二阶段冲突时拒绝并关闭连接，不打印成功，第一阶段已提交的基线仍保留；修复冲突后可幂等重试，不宣称整个 CLI 是一个事务。Web/worker 启动不自动执行该导入。

当前没有部署或供应商调用；真正上线等待正式迁移、当前默认检查与授权部署。
