# BOW-910 原生领域处理

本目录是 MCP 的服务端领域组合，供应商协议仍在 integrations/mcp。已实际消费 X1 固定3fef8c3的三个同事务入口及ca0完整来源图（#248/6563219742），不再依赖未实现的接口。实际部署接通仍需下面列出的共享入口。

- `handlers.ts` 只调用真实 person 读取和 demand/record producer 的 `createInTransaction`，不接受自定义 allow/execute 回调，不自行写领域 SQL，不调用模型。actor 取903当前身份；客户端 personIds 仅是受权限检查的业务对象。
- 写后再用相同 operation 的原生重放核当前权限、真实根/输入和回执，校验输出来自同一请求。重放必须返回 replayed=true，不另建job；所有调用在903拥有的同一事务内，任何拒绝必须回滚全部写入和入队。
- person_brief 消费完整当前快照（包括所有其他创建者、superseded intake、撤回事件及共享出处）；先用唯一 talentSources 生成完整限制，再去掉 performance 与未分类普通原件，最后调用现有 quickViewFromData。不能只移除引用而保留事件、能力线或参考象限。
- 无完整 intake 清单则 unavailable。普通原件需服务端原生 intake 的已校验性质；不能用标题猜“北森”，不能把 Web 的 HR 权限当 MCP 外发许可。原型快照仍受既有 demo/历史性质/来源校验。

## 原生组合与验证

`createMcpPostgresTools` 和 `createMcpPostgresHttp` 接收实际Database、既有单一PgBoss、903 identities和必填同事务audit函数。它们直接构造真实需求/记录producer及三handler；不注册worker、不调用模型、不生成token。每账号最多2个并发业务调用，不同凭据共享限额，所有结束路径释放；HTTP映射容量不足为429，原全局8个POST上限保留。

事务采用Read Committed，领域operation锁后重读当前事实；执行前后903重验身份及权限，输出授权再次以真实当前来源/原生幂等重放确认。预算异常必须逃出完整事务后才映射validation_error。只有审计成功后才能提交业务和队列；审核写入函数不是可选noop。person完整来源图在读取前不按目标人裁剪，最后投影发生变化则整次拒绝，避免旧DTO泄露。

统一单测和真实PG套件见 `postgres.integration.test.ts`：真实HTTP三工具、队列单次入队/并发重放/冲突、业务及队列/审计原子回滚、预算/字节上限、锁等待后撤权、读取中来源改变、真实目录换绑、每账号并发及错误释放。供应商token lookup是明确合成测试适配，当前目录/权限/业务/queue均是真实隔离PG。测试审计将五字段显式编码存入现有表，只证明同tx性质，不将该编码冒充批准的生产格式。

## 共享生产入口与整卡验收

共享审计现只有actor/action/resourceId，channel/revision的正式记录方式由X1给出；本目录不静默丢字段或另造表，缺audit拒绝构造。903外部token digest/revision native reader、唯一Web路由及部署级频率策略仍由对应writer接线。没有默认账号、管理员兜底或假handler。

真实部署后的Cloudflare Access双客户端验收仍归整卡，不能用回环HTTP和测试身份替代。未配置的渠道保持拒绝；不签发或创建生产token。PR保持Refs #233 / Part of BOW-910，正式依赖和当前head检查/交叉审查齐后推进Ready。
