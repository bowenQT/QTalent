# 解析附件到可确认草稿（限定路径）

## 前提与范围

本入口消费已经存在的完整 `mediaMaterials.intakeScope` 与对应真实
`material.capture` 审计。它不创建范围事实、不推断姓名，也不把上传人或
`unknown_person.bind_people` 的行为归属名单当作所有涉及主体。

通用 staged 上传目前没有完整范围的生产采集入口：解析成功仍进入待核对，
模型调用为零。此限制不会阻挡同批其他已具有可信完整范围的文件；本改动不新增
范围确认字段、API、界面或审批路径。集成测试的已知范围是明确的 SQL 夹具前提，
不是已实现范围采集入口的证据。

## 服务端入口

- `createParsedAttachmentWorker` 使用既有 boss、数据库、业务时钟和一次调用的
  845 Modelink client；只新增 `parsed-attachment-arrange` 队列。
- 解析 worker 的 `afterParse` 在解析事务结束后调用持久 producer；
  `afterRecovery` 扫描已终止解析，修复进程中断造成的未完成交接。
- producer 在同一事务中登记唯一文件 generation 与 queue 消息。稳定键含
  input/version、material/revision、parse/version、capture audit、当前核对操作/版本及
  实际处理账号，不使用父批次的实时 revision。
- `resolveMaterialPersonReviewAction` / `undoMaterialPersonReviewAction` 只接受已有
  897 严格人员核对合同。调用者可为当前有权的节点评价人、范围管理者或 HR；
  原上传人和实际核对人分别保留，权限不能互相代用。未知完整范围仍拒绝绑定入模型。
- 每文件复用 845：模型前/后核真实完整来源、归属与当前权限。文件完成仅追加新草稿；
  已有草稿、人工确认、事件映射不修改。实际来源保留原生 PDF/document 定位。
- 846 只对本 producer manifest 归属的草稿检查其精确核对依赖；undo/rebind
  不复活旧草稿，已真实确认的依赖禁止撤销。其他 producer 保留原确认规则。

## 状态与恢复

重复解析通知、命令重放和队列投递不重复模型/草稿；未知模型结果不自动重试。
取消/失败保留原件并在文件回执中明确标记，不以 `parsed` 冒充整理成功。
回执依据每文件 manifest 与现有 846 账本聚合；隐藏材料的 ID/数量不出现在
绑定动作的 remaining/blocking 列表，历史操作重放也重新做可见性过滤。

## 验证

作者测试：`append-drafts.test.ts`、`parsed-attachment-state.test.ts`、
`media-draft-dependencies.test.ts`；原生 PG：`parsed-attachment-flow.integration.test.ts`、
`parsed-attachment-append.integration.test.ts`、`attachment-person-review-undo.integration.test.ts`。
原生链路套件使用真实 PG、pg-boss、解析器、845 与 846，只控制外部对象流和模型。
运行需要隔离 `TEST_DATABASE_URL`；缺少它是失败，不以 skip 冒充通过。

依赖：#373 / #366 与 staged `35bb5fe308353f9e3264ef9de8abfc5a581e0c43`、
#375 TXT/DOCX、#376 来源投影。审查分支是明确未合并依赖快照，不代表已进入 main。
共享 worker/投影注册与 DOCX staged 兼容由协调作者整合，随本 PR 一起审查。
