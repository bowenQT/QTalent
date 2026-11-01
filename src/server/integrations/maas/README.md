# 七牛 MaaS 边界（BOW-843）

依据：[Spec v0.2](https://linear.app/bowenzhong/document/95ae37a621ad)。只提供供应商传输，不读数据库、不做授权、不包含业务提示词。`MaasClient.extract` 与 `createFakeMaas(result)` 旧行为保留；新增 `StructuredMaasClient.generateStructured` 是真实客户端与 fake 的共同接口。旧 `extract` 不猜测业务 prompt，也不自动转为付费调用。

## 使用

由服务端组合入口将环境变量中的密钥显式传入 `createMaasClient({ apiKey })`；原七牛构造器不自行读取环境、没有 import/构造副作用；可选 Modelink 变量已由 X1 接到共享环境入口，实际使用时仍由适配器校验，不要求构建拥有密钥。不要从浏览器输入接受配置或 transport。

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

## Modelink Gemini 扩展（10/31，BOW-843）

实际模型 ID 是 `google/gemini-3.8-flash`（10/31 匿名读取[官方模型列表](https://api.modelink.ai/v1/models)已确认）；目标固定为 `https://api.modelink.ai/v1/chat/completions`，不自动切换模型、域名或供应商。协议依据为 [Chat Completions](https://docs.modelink.ai/api/chat-openai)、[Gemini](https://docs.modelink.ai/models-capabilities/model-gemini) 和[请求 ID](https://docs.modelink.ai/troubleshooting-faq/request-id) 官方文档。这些资料与公开列表不能代替当前账号的真实调用验收。

- `createModelinkMaasClient` / `createFakeModelinkMaas` 使用相同 `generateStructured`、Zod object 校验与错误语义；保留原七牛客户端及 fake 的默认类型和行为。传输共用单次/总预算、取消、实际响应字节上限及保守重试规则。
- system/assistant 只接受文字；user 接受文字或 `text` / `image_url` 内容块。图片仅接受 PNG/JPEG/WebP 的规范 base64 data URI，单张不超过 4 MiB、最多 10 张；messages JSON 整体不超过 8 MiB，文字部分不超过 256 KiB。不接受远程原件 URL、签名地址、文件/音视频块或额外字段。调用方仍须先授权、过滤、最小化证据，再把已获准外发的图片字节交给客户端。
- 固定请求 JSON mode，完整响应必须为单个 assistant 结果且 `finish_reason=stop`、model 精确匹配，业务 schema 再校验枚举/必填/范围。无效响应、截断、超时、取消和未知结果均不返回成功值；不读数据库、不生成正式事实或人才结论。
- 除已校验的响应体 ID，还接受白名单字符且不超过 128 字符的 `http_x_reqid` 网关头，以保留失败请求的关联信息；原始响应、推理、图片、密钥不进入 metadata。
- 环境构造为显式 `createModelinkMaasClientFromEnv(environment?)`，只识别服务端 `MODELINK_API_KEY`（必填）、`MODELINK_BASE_URL`（可省略，固定为 `https://api.modelink.ai/v1`）、`MODELINK_MODEL`（可省略，固定为上述模型 ID）。不加载 `.env`，不借用七牛变量，不读取/持久化凭据文件，不在 import、构造、构建或自动测试中调用真实服务。

X1 已在公共 `index.ts` 导出 Modelink 客户端、显式环境工厂、fake、固定模型/endpoint 和输入类型；共享 `env.ts` 保留三个可选变量。业务方通过公共入口组合，仍须先授权再向适配器提供证据。内部通用 transport 与手动 probe 不对外导出。

### 显式手动验收

`modelink-probe.ts` 导入无副作用。`probeModelink` 显式执行时依次用合成文字和内置 128×128 纯色 PNG 调用真实客户端；没有人员资料，没有本地原件读取。报告只含时间、样本类型、结构/预期值是否通过、错误分类及 model/promptVersion/请求 ID/usage/耗时，不包含 prompts、图片或模型原始内容。未注入配置时只有 `configuration / attempts:0`，不能记为真实调用。脚本不写数据库。

已有凭据安全注入进程环境后，由获授权的会话在本 worktree 显式运行（Node 24）：

```sh
node --import tsx --input-type=module <<'JS'
const { probeModelink } = await import('./src/server/integrations/maas/modelink-probe.ts');
console.log(JSON.stringify(await probeModelink(), null, 2));
JS
```

把脱敏报告、受检 SHA 和执行环境贴回 #35；文字和图片各一次都有 `attempts>0`、结构及预期值通过，才是本卡真实调用通过的证据。超时/未知结果不自动重跑，显式重试须认识到可能重复计费。

所有者已统一指定本机加载入口 `~/.config/niu-talent/vendors.env`（见根 README）：仅在已授权的真实验证进程中先 `set -a; . ~/.config/niu-talent/vendors.env; set +a`。不读出、打印或复制文件内容，不搜索其他位置；部署机使用自己的环境。Modelink 只取 `MODELINK_*`，不借用七牛渠道的 base URL/model。

**Modelink 真实验收已有记录：** q843 在固定提交 `589827ddf87642e877a8b03c0148eb4cc000b472` 上用合成文字和纯色 PNG 各调用一次，均 HTTP 200、固定模型与业务结构/预期值通过，未重试、未写业务数据；[脱敏验收证据](https://github.com/bowenQT/QTalent/issues/35#issuecomment-6546420065)。X1 本次只改公共出口/环境与说明，供应商核心和 probe 文件未变，没有重复付费验证。BOW-895 的 Modelink 连通子项独立承接；#220（BOW-897）合入与当前 head 交叉审查仍是本 PR 的门槛。

## 原七牛实现验证记录与待验收（10/25）

SDD 使用已交叉审 spec。TDD：新增 48 项测试在实现前全部失败（缺失真实客户端/结构化接口），实现后全通过；追加取消校验/迟到流回收两项回归时确实失败，修复后共 56 项新测试及 5 项既有 fake 测试通过。测试使用 dummy credential 和 fetch 边界 stub，无真实外网调用。

实际本地命令：

- `node_modules/.bin/vitest run src/server/integrations/maas src/server/integrations/fakes.test.ts --coverage --coverage.include='src/server/integrations/maas/**/*.ts'`：61/61，改动范围行 97.82%、分支 89.87%。这不是工程统一全集覆盖率。
- `node_modules/.bin/tsc --noEmit`、`node_modules/.bin/eslint src/server/integrations/maas`：通过。
- 工程统一 coverage、构建及浏览器门禁以 PR 对应 head 的 GitHub Actions 为准。本云端 PostgreSQL socket 受限，不以 fake 替代数据库集成、不绕过限制。

**Pending：**目标模型/区域的实际可用性、JSON mode 实际效果、一次化名演示真实调用（含模型/版本、脱敏请求 ID、耗时与 usage）。本轮无获准使用的真实密钥/调用授权，未请求真实服务；卡片和 GitHub issue 保持未完成，PR 使用 Refs / Part of，不使用自动关闭关键词。v21 研究正文未获提供，不能声称读过或复现。没有合并或部署。
