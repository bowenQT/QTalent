# Jev 内部判断边界（BOW-850 部分交付）

依据：[条件式可执行 Spec v0.2](https://linear.app/bowenzhong/document/82ca2fc12371)。

保留 `JevClient.decide(input)` 与 `createFakeJev(conclusion)`：成功只返回
`{ conclusion }`，四态仍为 `supported / not_supported / insufficient / conflict`。
输入保持一条 requirement 和至少一条 `{ sourceRef, text }` 证据；拒绝空白值和
额外字段，但不改写原文。由调用方在执行前按当前权限筛选，本模块不读数据库或授权。

## 当前可用范围

- `createJevBoundary(execute?, { timeoutMs? })` 是内部规范化执行边界，不是供应商
  wire schema。`execute(input, signal)` 必须返回可运行时校验的 `{ conclusion }`。
  不传 execute 时，调用抛出 `JevError('configuration')`，不会访问网络。
- 可选的 `decide(input, { signal })` 支持取消；默认 15 秒，单次上限 20 秒。
  超时、取消均中止 signal，即使执行函数忽略取消也及时拒绝并丢弃迟到结果。
- 所有失败拒绝 Promise，不返回业务结论。错误的 `kind` 是稳定分类，`retryable`
  恒为 false；timeout、cancelled、outcome_unknown 保守标记 outcomeUnknown。
  未识别异常统一 outcome_unknown，不把断连视为“未送达”。没有自动重试、退避或渠道切换。
- 未来单一渠道适配器可以用 JevError 传递已核验的错误分类；边界重建错误，不带
  原始异常、材料、密钥。成功白名单投影丢弃 confidence、probabilities、debug 等字段。
  本实现不记录日志，也不持久化诊断值。
- 调用方应捕获 JevError，按用例合同进入“待人工判断”且 conclusion 留空；不能把
  失败转为 insufficient。这里不写 job 或业务状态，尚未宣称 851/854 端到端通过。

## 尚未实现，不得视为已完成验收

目标海外渠道尚未确认。现有 `jevConfigSchema` 仅验证显式 HTTPS endpoint、非空
apiKey 和精确模型 `typesafe/jev-1.14`，配置本身不选择或启用渠道。没有 fetch、SDK、
凭据读取、真实 wire mapper、供应商请求/响应体大小限制或 HTTP 状态分类实现；这些
必须在选定渠道的协议核验后补齐，不能把本内部 seam 当作已集成真实 API。

没有自动采用 OpenRouter、七牛或原厂，也没有用 `jev-1.14.0` 替换模型。公开的
OpenRouter 协议只证明候选方案存在，不表示项目已选用或授权调用。

真实 transport 接线、provider wire-schema 测试、环境配置接线和化名演示真实调用
仍待完成；无真实调用/费用/部署。当前 PR 使用 `Refs #42 / Part of BOW-850`，
原任务保持未完成。共享配置、公共契约、CI 与依赖不在本目录的改动范围。
