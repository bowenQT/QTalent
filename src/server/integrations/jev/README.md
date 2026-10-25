# Jev 客户端（BOW-850）

依据：[Spec v0.2 及 Modelink 接续说明](https://linear.app/bowenzhong/document/82ca2fc12371)、
[System One](https://docs.modelink.ai/api/systemone)、
[Jev 使用说明](https://docs.modelink.ai/models-capabilities/model-jev)（2026-10-25 核对）。

## 显式接入

```ts
import { createJevClientFromEnv } from '@/server/integrations/jev';

// 仅在服务端组合入口显式选择真实客户端。此处不发送请求。
const jev = createJevClientFromEnv();
// requirement/evidence 已由用例按当前权限过滤，再显式 await jev.decide(input)。
```

| 既有环境变量         | 用途                                       |
| -------------------- | ------------------------------------------ |
| `QINIU_MAAS_API_KEY` | 共用 MaaS Bearer key，必填；不另设 Jev key |
| `QINIU_JEV_BASE_URL` | 默认且仅接受 `https://api.modelink.ai/v1`  |
| `QINIU_JEV_MODEL`    | 默认且仅接受 `typesafe/jev-1.14`           |

只在调用环境工厂时读取进程环境；也可传入环境对象作测试或显式组合。
不读取 `.env`、不持久化凭据、不修改环境、不探测服务。国内 `QINIU_MAAS_BASE_URL`
不参与 Jev 地址选择，海外失败也不回退国内。共享 `getEnv()`、部署清单和 worker
未改；后续用例在获准的组合入口选工厂前，继续使用 fake。

`createJevClient({ apiKey, endpoint?, model?, timeoutMs?, maxRequestBytes?, maxResponseBytes? })`
支持显式注入配置；第二参数的 fetch 只用于可信服务端测试边界。配置错误在 decide
时抛脱敏的 configuration，零请求；import、构造、构建均不调用供应商。
既有 `jevConfigSchema` 保持兼容，只是基础形状校验；真实工厂还严格限制目标地址/模型。

## 输入、wire 映射与输出

保持 `JevClient.decide({ requirement, evidence: [{ sourceRef, text }] }, { signal? })`。
输入至少一条证据，拒绝空白和额外字段；不改写原文、不截断证据、不补读数据库。
用例负责单个候选人、要求、时间/情境及来源的授权筛选，执行前重新授权。

- POST `https://api.modelink.ai/v1/systemone`，Bearer + JSON，禁止重定向。
- 顶层只有固定 model、state、questions。state 逐字保留 requirement，证据映射为
  `{ source_segment_id: sourceRef, quote: text }`。
- 既定接口没有 person_id、assessment_scope 或 kind，故不编造这些值、不把自述或
  事实统一冒充管理观察，也不为接线扩大公共契约。需要这些独立字段时由契约卡先行定义。
- `questions.requirement_match` 是一题 choice，四项 criteria 与 instructions 取自
  已冻结的合成实验规则，版本 `JEV_PROMPT_VERSION = requirement-match-v1`。不生成解释或引用。
- 严格校验响应精确 model、单一同名答案、choice 类型、完整四项概率及其范围、confidence、
  id 与 usage；显式 0 合法，缺字段不补零。未知枚举、错题、多答案、坏 JSON/UTF-8 均失败。
- 只投影 `{ conclusion }`。wire `conflicting` 映射内部 `conflict`，其余为 supported、
  not_supported、insufficient。confidence、概率、usage、raw/debug 不返回、不记录或持久化。

`createFakeJev(conclusion)` 和 `createJevBoundary(execute?, options?)` 保持原合同；
内部边界移至 boundary.ts，index.ts 仍是唯一公开入口。fake 不依赖供应商或真实凭据。

## 失败、预算与取消

所有失败抛 `JevError`，没有业务结论；用例进入“待人工判断”、结论留空，不能变成 insufficient。
错误仅含稳定 kind、retryable 与 outcomeUnknown，不携带材料、密钥、供应商正文或原始异常。

| 失败                      | kind                                          | outcomeUnknown                 |
| ------------------------- | --------------------------------------------- | ------------------------------ |
| 本地配置 / 输入校验       | configuration / invalid_request               | false                          |
| HTTP 400 / 401 / 403      | invalid_request / authentication / permission | false                          |
| HTTP 429 / 5xx            | rate_limited / unavailable                    | true                           |
| HTTP 其他响应、无效成功体 | invalid_response                              | true                           |
| fetch 失败、响应流断连    | outcome_unknown                               | true                           |
| 超时 / 取消               | timeout / cancelled                           | true（含发送前取消的保守标记） |

单次默认 15 秒，可显式调整但最多 20 秒，包含等待 header 与读取正文。仅一次 HTTP attempt，
retryable 恒 false；无自动重试/退避。状态码和 Retry-After 不证明供应商未处理/未计费，
故不重发。Native fetch 也不能证明失败请求从未送达；后续人工显式重试及任务幂等由用例协调。

取消贯穿 fetch 和读流；执行忽略 signal 时边界仍及时拒绝，迟到响应丢弃并取消其正文。
超限或 HTTP 错误取消正文，不等待可能卡住的清理回调。响应实际 UTF-8 字节逐块计数，
不信任 Content-Length；本实现不写日志。

默认请求保护为 24 KiB、响应保护为 2,000,000 字节，显式工厂可降低。它们是应用保护，
不是供应商硬限。历史实验的 24KB/50秒/2MB 同属实验保护；正式工程没有沿用 50 秒，
服从既有 15/20 秒预算。

## 验证与剩余验收

本轮新增 70 项离线测试先 red（真实客户端/环境工厂缺失），实现后 green；连同既有边界与
fake 共 109/109 通过，类型检查与定向 ESLint 通过。用合成 key、fetch 边界 stub、真实
Response/ReadableStream 和可控时钟验证；不是供应商调用。工程统一门禁见 PR 对应 head。

本机只读核对了 v23 研究报告、2026-10-24 Jev 1.14 海外完整复测 README 及非秘密协议脚本，
没有复制本地报告或读取 `.env` / key。历史 24 例每态 6，首次 22/24，TLS 补测后 24/24
与预置参考一致；未经业务标注，不能称业务准确率，也不等于本提交真实验收。

当前工程的一次化名演示真实调用仍未执行，本轮明确不做付费请求、不配置凭据持续访问。
851/854 的端到端授权、待人工判断落库与任务版本栅栏仍由对应卡验收。PR 使用
`Refs #42 / Part of BOW-850`，卡和 issue 保持未完成；不合并、不部署。
