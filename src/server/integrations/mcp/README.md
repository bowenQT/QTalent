# BOW-910 MCP 三工具：协议适配第一片

本片实现可直接处理标准 Request/Response 的 Streamable HTTP 适配，以及三个工具到实际 BOW-903 用例的分派。没有 Next 路由、生产 listener、个人令牌发行、数据库适配或部署。默认没有生产工具 handler；缺失时返回 unavailable。定向 HTTP 用例的身份、材料和领域 I/O 全为明确的合成输入，不代表正式客户端、真实业务或部署验收。

## 固定输入

- 起点 main：91b297afbc005a26a0f9bd93a2126fbd1d2fe6c9。
- BOW-903：80b4755d6e96a3462e9a56c0ac0a7944b5be767e，普通合并，不复制身份、节点、材料或业务合同。
- BOW-895 MCP 历史实验：bd2e9f1af5e563c8effb5e1ab664b4552577c096。两个实际客户端的合成只读调用已在 #218/6547057111 记录；不是本片的真实三工具验收。
- 没有 MCP SDK 依赖，使用现有 Node/Web HTTP API 和 Zod。协议依据为 [MCP 2025-11-25 Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)、[生命周期](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)和[工具](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)。

## 服务端组合

由可信服务端调用 createMcpTools，传入同一实例的 903 identities，以及原有 loadContext、transactions、handlers；随后 createMcpHttpHandler 接收 tools 和显式 canonical endpoint。本目录不新增另一套身份、授权、持久化或领域端口，也不读取环境变量。

只从原有 handler 表选取 record_moment、person_brief、draft_requirement。输入 JSON Schema 从冻结 Zod 合同生成，不能表达的 refine 仍由真实 903 运行时校验。工具参数不接受客户端角色或账号。确认、评分确认、需求确认、发布和其他入口的工具名均不可用。

安装 handler 必须满足 903 的 authorize / execute / authorizeOutput 契约。其中 authorizeOutput 必须从权威来源记录解析真实输出所涉及的全部材料与引用：

1. 按当前账号、当前节点关系与有效期核验所有对象、文本及来源。
2. 排除北森绩效和晋升的原文、摘要以及直接或间接引用；HR 的 Web 可见性不等于允许经 MCP 返回。
3. 来源不全、性质未知、权限事实缺失或无法可信过滤时返回 false；不能依据 DTO 形状、客户端安全标记或敏感词扫描放行。

本模块只信任显式安装的服务端输出授权结果，不能从 QuickView 中的 fragmentId 自行推断来源性质。当前没有已完成上述要求的生产 handler，不应把普通 Web handler 原样安装为默认实现。测试中的独立合成来源清单证明拒绝被传输层保持，不能证明缺失的生产来源读取已完成。

调用走实际 createEntryToolUsecase：执行前后重新读取身份和权限，校验输出对象/版本，再执行输出授权。拒绝会抛出事务，由外层统一映射；实际 PostgreSQL 回滚与锁语义仍由生产事务适配器保证。审计仍使用 903，只记录账号、渠道、固定工具名、对象和版本，不记录 token、参数、原文或原始异常。

## HTTP 行为

- 单一显式端点；生产要求 HTTPS，HTTP 只允许 loopback。请求 URL origin、Host 和出现的 Origin 必须匹配配置；不信任转发头、Access 邮箱头或参数中的身份。
- 每个请求从 Authorization 的 Bearer 经实际 903 身份服务验证并回查绑定。无/错/撤销凭证为 401，身份服务不可用为 503。没有新令牌、OAuth 登录或持久客户端配置。
- POST 要求 application/json 和同时接受 application/json、text/event-stream。返回 JSON，不提供 SSE；已认证 GET/DELETE/OPTIONS 返回 405。
- 支持 2025-03-26、2025-06-18、2025-11-25 的此处共用消息子集；初始化协商，不支持的版本头为 400。无版本头按规范兼容旧 Streamable HTTP；不提供旧 HTTP+SSE 传输。
- 无服务端 MCP session、重放流或跨请求能力缓存，不发行 MCP-Session-Id；携带该头会拒绝。客户端仍须先 initialize，再发送 initialized 通知；每次业务调用独立认证。
- 只声明固定 tools 能力，支持 initialize、ping、tools/list、tools/call。initialized、cancelled 通知可返回空 202；tools/call 不能作为通知产生写入。收到 cancelled 只是接收协议通知，不代表取消已提交的领域任务。断开 HTTP 同样不代表撤销或取消任务。
- 协议错误保留请求 ID，不回显参数；领域验证/权限/不可用结果作为 isError=true 的工具结果。成功与失败的 structuredContent 和文本 JSON 一致。没有原始异常或原始 ActionResult 回传。
- 请求体限 256 KiB、读取限 5 秒、最多 8 个处理中 POST；超限 413/408/429，完成与失败都会归还槽。这是进程内并发边界，生产入口仍须有服务端按身份的调用频率限制，不能将它称为分布式配额或幂等账本。

## 验证与后续

定向命令（单测最多两个 worker）：

    pnpm exec vitest run src/server/integrations/mcp/ --maxWorkers=2 \
      --coverage --coverage.include='src/server/integrations/mcp/{http,tools}.ts'

HTTP 测试自己在 127.0.0.1 选择空闲端口，结束时关闭 listener 与连接。没有供应商调用、数据库、真实账号凭证或外部客户端会话。测试事务只证明用例要求回滚，不冒充 PG 原子性。完整 check/integration/e2e/visual 仍须遵守共享 resource-heavy-1/2 锁。

共享与真实接线交 X1 协调：生产 MCP 令牌到账号绑定及撤销回查、三领域 handler 和来源性质过滤、事务/审计与并发撤权、必要公共出口与入口导入边界、唯一 Web 路由和按身份限流。本片不改 package/lock、worker、公共 index、数据库 schema 或迁移。

正式客户端配置须使用 X2 确认的精确部署 URL、已批准的 Cloudflare Access 接入方式及正式个人令牌方案；当前三者未就绪，所以本片不提供可直接连接的配置、不复用 895 的一次性测试认证值、不声明正式 Codex/Claude Code 已接通。

PR 使用 Refs #233 / Part of BOW-910；903、845、852、837、895 的实际 main 依赖保持。关闭卡必须补：已部署环境经 Cloudflare Access，Claude Code 与 Codex 分别真实调用三个工具、越权与撤权后拒绝、绩效/晋升文本及引用不外发的证据。局部协议通过不满足这些条件。
