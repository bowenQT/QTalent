# 听悟离线转写

依据 [BOW-857 SDD v1.1](https://linear.app/bowenzhong/document/65eee2324cbb)。本目录只负责离线供应商协议、结果解析和稳定错误分类，不访问数据库、不绑定员工、不创建事件。真实入口由服务端配置创建上级 `http.ts` 的 `createTingwuHttp`，再将 `request` 显式注入 `createOfflineTingwu`。工厂不读环境、不自动联网，缺配置明确失败；原有 `createFakeTingwu` 保留。

## 提交与恢复

- `submitOffline` 接收 Kodo `TranscriptionSource` 能力及 873/859 已探测的服务端媒体元数据。只接受 MP3/M4A/WAV/AAC 音频与含音轨的 MP4 视频、单个最多 2×1024³ 字节；`maxDurationMs` 必须由调用方显式配置，且不超过供应商的六小时上限。本卡不把声明格式当作真实内容探测。视频提交原始 MP4 的私有 Kodo 来源 URL，由听悟只转写音轨；不提前把本地提取的 WAV 当作视频输入，不启用画面/PPT、摘要或其他算法。873/859 必须探测容器、音轨和时长；本客户端只复核已验证元数据。依据为官方[离线音视频说明](https://help.aliyun.com/zh/tingwu/offline-transcribe-of-audio-and-video-files)。
- 真正提交时来源剩余有效期至少三小时，`submitSafetyMs` 可增加安全余量。队列只存原件引用；859 在出队提交前签发来源，过期且尚未发送时可重新签发。
- 使用 `PUT /openapi/tingwu/v2/tasks?type=offline`，只开启说话人分离。`operationId` 作为 `TaskKey` 关联调用，不宣称供应商保证幂等。
- 每次提交只发一次请求。超时、传输错误、发送后的取消或无法解析的响应均为 `submission_unknown`，不自动重提。若取消前已收到合法 TaskId，错误携带 `providerTaskId` 供调用方持久化并核查原任务。未知结果不能因为旧来源过期就重新创建任务。
- `queryOffline` 单次查询返回 `running/completed/failed`。官方没有独立 queued 状态；应用排队属于 859 的本地任务事实。`retryable` 只表示上层有界重试资格，859 仍须限制次数和总时长并服从取消。取消不承诺已撤回供应商任务或费用。

## 结果与来源

`getTranscript` 重新查询原 TaskId，仅在 `COMPLETED` 后下载结果。供应商完成不代表结果已经归档；859 仍须保存全文、转写版本和片段，再继续整理。结果 URL 只在服务器内部使用，不进入 DTO、日志或任务快照。

结果下载只允许服务端配置的完全匹配 HTTPS origin，拒绝重定向、URL 身份信息和片段；等待上限十秒，实际读取上限 16 MiB。官方示例中存在 HTTP 结果 URL，真实账号是否提供可接受的 HTTPS 结果仍待联调；不能静默降级或修改地址。

逐句结果保留原字词、毫秒起止、交叠与缺失说话人。`providerSentenceId` 是段落 ID 与句 ID 的组合，业务来源身份由 records 建立。说话人编号只是录音内标识，不自动绑定员工。明确空 `Paragraphs` 表示无语音；缺字段、重复标识、非法/倒退时间或超出音频时长都报错，不静默丢句后返回完整成功。实时预览不进入此离线端口。

859 负责完整归档后提交、TaskId/operationId/revision/attempt 持久化、轮询、旧结果隔离与离线结果归档；860 负责说话人绑定。离线稿是事件提取的唯一来源。

## 验证边界

自动测试只替换 `request` 和 `fetch` 外部边界，运行同一 TTL、状态、解析及错误规则，全部使用合成资料。真实合成录音调用、真实账号的结果域名/HTTPS，以及 873/859 的实际内容探测和持久化联测仍待验收；旧的六十分钟实验不能作为本实现的验收结果。

协议于 2026-10-25 只读核对：[CreateTask](https://help.aliyun.com/zh/tingwu/api-tingwu-2023-09-30-createtask)、[GetTaskInfo](https://help.aliyun.com/zh/tingwu/api-tingwu-2023-09-30-gettaskinfo)、[转写结果字段](https://help.aliyun.com/zh/tingwu/voice-transcription)。API 版本 `2023-09-30` 与 ACS3 签名由上级 HTTP 适配器负责。BOW-865 / PR #92 的 HTTP 与实时模块已随 main `37f987dd019cc2f10f25346301dc83244aa7837b` 合入，本卡仅交付 `offline/`。

历史组合验证使用 main `387ad10`、本卡离线候选及固定 #92 head `1abcf717d7251593ea73a3e34efbe683ab13b4be` 的临时 HTTP 源码与测试；该验证只能证明当时组合，临时依赖随后完整移除。最终独立检查以包含 #92 的已合 main 为基线，使用仓库内正式 HTTP 与实时模块，不再依赖临时文件。`check`、e2e、visual 的最终结果与受检 head 在 PR 中分别记录，历史组合结果不替代独立分支结果。
