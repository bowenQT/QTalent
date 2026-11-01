# BOW-915 Native 协议适配

固定895真实探针 `2eeb4f7d` 已证明两独立用户回合+自定义工具；此目录将同一公开协议实现为可组合客户端，不复制实验CLI、账户配置或私有标识。

`createAgentApiClient(config, fetch?)` 只接显式配置，不在导入时读取env或外发。生产共享配置入口需从进程环境提供 `QINIU_MAAS_API_KEY`，以及已核准的region、agentId/version、environmentId、modelId；这些普通配置仍不公开基础设施原值。当前没有env factory或真实调用CLI。真实调用只允许获准进程source vendors.env，本轮没有加载文件或声称变量存在。

- 仅官方已确认区域origin，禁止任意URL和重定向。创建会话固定Native版本，显式清空MCP/skills/resources/vault，回显工具/schema、模型、system、空multiagent全部核对。污染配置返回已创建session标识供可信清理，绝不发送用户输入。
- create/send/archive为有副作用POST，不自动重试。5xx、传输中断或成功响应无法确认一律保留uncertain；调用方先查询已有会话/事件，不能自动再次提交。创建结果未知且无sessionId时尤其不能假装已清理。
- 15秒单请求、256KiB请求、1MiB响应、最多5页各100事件；读取超限取消body。事件只保留业务所需字段，错误正文/telemetry不回显。
- 每个用户消息、自定义工具结果、中断单独提交并核ACK类型。GET历史完整分页；循环游标/页上限拒绝，不以截断列表当完整历史。
- archive之后再GET核terminated/archived_at。归档不是回滚领域工具，也不能抹除已发送的云端记忆；权限失效必须本地先拒绝旧会话，再处理清理。

离线测试只注入fetch边界，实际解析、预算、回显检查和错误分类全部运行。没有供应商、SDK、环境、token创建或前端。协议依据：

- [会话创建与覆盖](https://developer.qiniu.com/agentapi/13596/agentapi-sessions-and-tasks-session)
- [事件、回放和停止原因](https://developer.qiniu.com/agentapi/13597/agentapi-sessions-and-tasks-events)
- [会话操作与归档](https://developer.qiniu.com/agentapi/13598/agentapi-sessions-and-tasks-session-lifecycle)

此客户端不是完整915：真实会话账本/权限复核/工具producer的应用组合在同卡继续实现，不能以协议测试冒三幕部署验收。
