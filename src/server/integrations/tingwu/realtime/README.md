# BOW-865 实时预览适配器

依据：[SDD v1.1](https://linear.app/bowenzhong/document/ec02ae5e59b9)、[记录 API](https://help.aliyun.com/zh/tingwu/interface-and-implementation/)、[听悟推流示例](https://help.aliyun.com/zh/tingwu/real-time-stream-push)、[WebSocket 协议](https://help.aliyun.com/zh/isi/user-guide/websocket)、[ACS3 签名](https://help.aliyun.com/zh/sdk/product-overview/v3-request-structure-and-signature)，2026-10-25 核对。

## 服务端调用边界

显式调用 `createTingwuRealtimeFromEnv()`，从环境读取 `ALIBABA_CLOUD_ACCESS_KEY_ID`、`ALIBABA_CLOUD_ACCESS_KEY_SECRET`、`TINGWU_APP_KEY`。无配置即抛出 `configuration_error`；构造、导入与构建不触网。未接入应用，不改变现有离线 fake。HTTP 仅允许北京听悟固定 endpoint，不跟随重定向；无新增依赖。共享 `../http.ts` 由 BOW-865 唯一维护，后续 BOW-857 可复用。

`createRecord({ sessionId, sampleRate: 16000 })` 创建记录，返回仅服务端持有的 record。`TaskId` 是记录 API 标识，`startCycle(callbacks)` 每次生成独立推流 `task_id`；应用 `sessionId` 不替代二者。连接 URL 留在闭包，不交给浏览器或日志。输入限 PCM16、单声道，采样率 8k/16k；原始 PCM 不包含 WAV 头。

调用 `cycle.ready` 后才能 `pushPcm(bytes)`；`accepted` 只表示本地 WebSocket 接受，不代表供应商识别或 Kodo 归档。调用方先归档，按实时音频节奏发送，100ms PCM16k 为 3200 字节。本适配器不积压应用音频，不重连或补发；发送层总缓冲最多 64000 字节，超出返回 `backpressure` 且不保留该帧。该值是可测试的最小工程限制，不是产品录音容量。

## 停止、暂停与结束

`stopGracefully()` 停止收帧，Stop 在已接受帧之后按 WebSocket 顺序发送；重复调用共享同一 Promise。最后句仍返回 `kind: 'preview'`，只有当前 `task_id` 的完成事件才能返回 `stopped` 并关闭。close 或 TaskFailed 不是完成。握手/ready、Stop 和 HTTP 均限时 10 秒，可注入时钟；超时、断线与主动 abort 分开返回，对端结果未知不冒充成功。

暂停只 stop，不 finalize。继续由调用方显式 `record.startCycle()`，同一记录另建识别周期，无自动重连；上个周期的晚事件不能影响新周期。用户真正结束时，在当前周期 stopped 后单独调用 `record.finalizeRecord()`。该写入只尝试一次，同对象重复调用共享结果。`finalized` 指记录结束请求获确认，不代表离线全文完成；`failed`/`unknown` 独立报告。未知不能盲重试，尤其不得重新创建记录来掩盖未知写入。业务层应保留 TaskId 供后续核查；此进程内去重不替代 BOW-868 的跨重启持久化编排。

只输出预览回调与脱敏错误码；不产出事件提取输入，不保存业务记录，不决定浏览器授权/音频归档/离线流程。BOW-868 的归档失败不得 push、实时失败仍继续归档等集成验收仍属于该卡。

## 验证边界

就近测试替换 HTTP/WebSocket 外部边界，验证真实协议转换与状态机，不调用供应商。真实合成演示音频推流仍 Pending：未获真实调用授权、未配置凭据、未部署。待授权后记录受检 SHA、音频长度/格式、正常 Stop 的最后句与完成事件顺序、硬断错误；不可将既有 v21 的实验数字当作此次结果。此 PR 为部分交付，不关闭 BOW-865 / #57。
