# 七牛 MaaS 边界（BOW-843）

依据：[Spec v0.2](https://linear.app/bowenzhong/document/95ae37a621ad)。只提供供应商传输，不读数据库、不做授权、不包含业务提示词。`MaasClient.extract` 与 `createFakeMaas(result)` 旧行为保留；新增 `StructuredMaasClient.generateStructured` 是真实客户端与 fake 的共同接口。旧 `extract` 不猜测业务 prompt，也不自动转为付费调用。

## 使用

由服务端组合入口将环境变量中的密钥显式传入 `createMaasClient({ apiKey })`；本模块不自行读取环境、没有 import/构造副作用、不修改共享环境清单。基础 `env.ts` 尚无 MaaS 变量接线，该接线由共享配置责任人负责，未接线时维持 fake，不要求构建拥有密钥。不要从浏览器输入接受配置或 transport。

调用 `generateStructured({ messages, promptVersion, schema, signal? })`：

- `messages` 只能包含调用者已授权且最小化的文字证据，角色为 system/user/assistant；至少一条明确要求 JSON。JSON 编码后的 messages 最多 256 KiB / 100 条。
- `schema` 必须为具体 Zod object，业务方声明必填项、枚举和数值范围，不使用 unknown/any schema 或宽松 coercion 来伪装成功。不发送 schema 或业务校验错误给供应商。
- `promptVersion` 为调用方版本标识（1–128 个 ASCII 字母/数字及 `._:/-`），返回 metadata 原样保留。
- 只有 `ok: true` 才有 `value`；元数据白名单包含固定 model、promptVersion、attempts、elapsedMs，以及可用且格式合法的 requestId/usage。原始响应、思维链、HTTP 错误正文、密钥不返回或记录；本模块不写日志。
- `createFakeMaas(result).generateStructured` 使用相同输入/输出校验；它不是供应商联调证据，attempts 恒为 0。

## 协议与参数

固定 `https://api.qnaigc.com/v1/chat/completions`、Bearer 认证、POST、非流式、`response_format: { type: 'json_object' }`；禁止重定向。请求及响应模型都必须是 `deepseek/deepseek-v4.1-flash`，不自动替换或回退渠道。不同模型/endpoint 显式配置返回 configuration。

默认：单次 30 秒、整次 45 秒、最多 2 次 HTTP 尝试、预发送失败退避 250ms、max_tokens 4096、响应正文实际字节上限 1 MiB。服务端可向下调整超时/重试/响应上限；maxTokens 可调整至 16384。超时涵盖读取正文；无效 UTF-8、空内容、非 JSON、截断 finish_reason、错误模型、错误结构及超限正文全部拒绝。

官方依据（2026-10-25 核对）：[接入与鉴权](https://developer.qiniu.com/aitokenapi/13379/real-time-ai-interface-api)、[消息与 JSON 参数](https://developer.qiniu.com/aitokenapi/13390/chat-completions)。这些只证明七牛通用协议，不能证明指定模型在当前账号/区域已开放或严格遵守 schema；这部分仍待真实验收。

## 失败、取消与任务重试

- configuration / invalid_request / authentication / permission / invalid_response：不重试，无成功值。
- 发送前取消：cancelled，不发请求。发送后取消或超时：outcome_unknown，reason 为 cancelled/timeout；供应商可能已执行/计费，禁止自动重发。晚到响应丢弃并取消其正文流。
- fetch 普通错误、读流中断、429/5xx 或无法解释的 HTTP 响应：outcome_unknown，不重试。reason 区分 network/rate_limited/unavailable；状态码本身不证明供应商未处理。没有已核实的拒绝执行保证，故 Retry-After 不触发重发。
- 仅可信服务端 transport 明确抛出 `MaasRequestNotSentError` 才证明发送前失败，可在同一总预算内重试一次。默认原生 fetch 无此证明，保守不重试；不能把普通 fetch TypeError 包装成这个错误。
- 耗尽发送前重试预算返回 network / retryable:true。任务层仍须共享总尝试/时间预算，不能无限任务重试乘以 adapter 重试。任务层需要自行重试时传 maxAttempts:1。outcome_unknown 永不自动重试；人工显式重试须承认可能重复计费，业务幂等/版本栅栏仍由用例层实现。
- 本版本只交付非流式最终结构化结果；业务进度不传原始 token。若后续契约要求流式，先更新 spec，不凭本实现宣称流式已验收。

## 验证记录与待验收

SDD 使用已交叉审 spec。TDD：新增 48 项测试在实现前全部失败（缺失真实客户端/结构化接口），实现后全通过；追加取消校验/迟到流回收两项回归时确实失败，修复后共 56 项新测试及 5 项既有 fake 测试通过。测试使用 dummy credential 和 fetch 边界 stub，无真实外网调用。

实际本地命令：

- `node_modules/.bin/vitest run src/server/integrations/maas src/server/integrations/fakes.test.ts --coverage --coverage.include='src/server/integrations/maas/**/*.ts'`：61/61，改动范围行 97.82%、分支 89.87%。这不是工程统一全集覆盖率。
- `node_modules/.bin/tsc --noEmit`、`node_modules/.bin/eslint src/server/integrations/maas`：通过。
- 工程统一 coverage、构建及浏览器门禁以 PR 对应 head 的 GitHub Actions 为准。本云端 PostgreSQL socket 受限，不以 fake 替代数据库集成、不绕过限制。

**Pending：**目标模型/区域的实际可用性、JSON mode 实际效果、一次化名演示真实调用（含模型/版本、脱敏请求 ID、耗时与 usage）。本轮无获准使用的真实密钥/调用授权，未请求真实服务；卡片和 GitHub issue 保持未完成，PR 使用 Refs / Part of，不使用自动关闭关键词。v21 研究正文未获提供，不能声称读过或复现。没有合并或部署。
