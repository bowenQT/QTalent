# 入口凭据与当前绑定

本片只提供三张表和原生只读 authenticator，不创建真实凭据、绑定、账号或管理 API。Web 入口继续使用已有 `web.ts`。

- `schema.ts`：MCP 凭据、WeCom 发送者映射、AgentAPI 会话归属各自独立。稳定 id、account FK、正 revision、明确 expiresAt/revokedAt；没有角色、grant、明文 token 或重复 person 列。
- `persistent.ts`：`createMcpEntryAuthenticator` 消费高熵 bearer token（32–512 字符，无空白/控制字符），只以域分离 SHA-256 查询。它不签发 token；低熵口令不得作为 bearer token 配置。
- `createWecomEntryAuthenticator` 的回调必须由已验证 WS 连接提供 scope/bot/sender。`createAgentApiEntryAuthenticator` 的回调必须来自已通过 Access/Better Auth 的服务器 Web 会话及该用户发起的 agent/session 归属。请求 JSON、聊天声称的身份和 agent 自报 userId 均不是这些回调的实现。
- 三个 reader 使用 pool Database，在验证回调完成后读取真实绑定，拒绝 system-admin、缺映射、过期、撤销及绑定摘要不符。AgentAPI 额外核真实 auth_session owner，并取会话/凭据较早截止；不读取 auth_session.token 或 OAuth 私有列。

`entryAccountBindingDigest(accountId, personId)` 是签发时范围的域分离摘要，**不是当前人员目录**。每次读取仍从 directory 唯一绑定取得 person 并重算比较；仅有 accountId 会让旧 token 在换绑后直接变成新人的身份，因此需要这一证明。它不是秘密、不是授权，也不赋予任何角色。未来受信配置 writer 必须在同一事务锁定当前绑定，凭据内容/范围修改时增加 revision，撤销旧凭据，不自动跟随换绑重算摘要。本片没有该配置 writer，也不推断绑定历史；撤销后已失败的能力由现 identity service 永久退役。业务操作仍在各自事务内锁定并重验当前领域权限，认证不替代授权。

三个 reader 安装到现 `createEntryIdentityService`，对外仍只产生不可序列化的进程内 capability。上层负责将原生异常映射为既有安全错误；不得记录 bearer token、验证回调的秘密或数据库连接串。

## 验证与迁移边界

`persistent.integration.test.ts` 建立随机隔离 `_test` 数据库，默认运行正式迁移。当前正式游标尚未到 903；临时结构验证可仅向该测试进程传 `BOW_903_TEST_MIGRATIONS_DIR` 指向从当前 schema 原生生成的临时目录，目录先复制已发布 0000–0009，不改 SQL/meta。临时 SQL 不提交，默认 CI 不借该变量伪绿；正式迁移可用时退役覆盖入口。

只使用合成人员/组织/凭据，覆盖三渠道当前绑定、换绑、撤销、过期、revision、可信连接元组、真实 Web 会话 owner/截止、异步等待后重新读取、数据库唯一/FK/check 与事务回滚。不存在真实供应商、生产 token 或生产绑定验收。
