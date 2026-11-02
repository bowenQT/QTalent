# 入口审计承载

现 `EntryAudit` 的 channel 和 revision 通过 `usecases/entry/audit.ts::recordEntryAudit` 写入同一调用方事务。revision 是**业务资源版本**，不是凭据 revision；不能拿原文、token 或整个 DTO 填 resourceId。

metadata 只允许 `{channel: web|wecom|mcp|agentapi, revision: 正安全整数|null}`，没有任意扩展键；运行时 Zod strict 与 SQL 独立校验。旧调用不传 metadata，历史行保持 null。现入口合同 resourceId 允许 null，所以对应数据库列改可空，保留真实“无资源”，不填空字符串或猜资源。actor/action/at 仍必填。

默认正式迁移尚未覆盖本片 DDL（metadata JSONB nullable、resource_id DROP NOT NULL），不得只靠这份结构把默认 CI 标绿；随入口持久结构在既定迁移游标后原生生成。合成 PG 使用同一临时目录，证明 caller rollback、提交前不可见、真实 null、旧事件兼容，以及 SQL/运行时均拒绝敏感扩展键/错误版本。
