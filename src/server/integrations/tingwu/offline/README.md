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

结果下载只允许服务端配置的完全匹配 HTTPS origin，拒绝重定向、URL 身份信息和片段；等待上限十秒，实际读取上限 16 MiB。官方旧示例中的 `speech-swap` origin 不是所有账号的生产配置。11/1 本卡实际认证查询返回 `https://prod-tingwu-paas-common-beijing.oss-cn-beijing.aliyuncs.com`，该精确 origin 也可由[阿里云官方听悟结果说明](https://help.aliyun.com/zh/model-studio/tingwu-meeting-offline-api-get-task)核实。本轮仅在验收调用方配置该精确值，保留客户端原有 HTTPS 和白名单校验；不能自动信任响应中的任意 origin、使用 OSS 通配域名、降级或改写结果 URL。生产 859 配置接线仍归对应卡。

逐句结果保留原字词、毫秒起止、交叠与缺失说话人。`providerSentenceId` 是段落 ID 与句 ID 的组合，业务来源身份由 records 建立。说话人编号只是录音内标识，不自动绑定员工。明确空 `Paragraphs` 表示无语音；缺字段、重复标识、非法/倒退时间或超出音频时长都报错，不静默丢句后返回完整成功。实时预览不进入此离线端口。

859 负责完整归档后提交、TaskId/operationId/revision/attempt 持久化、轮询、旧结果隔离与离线结果归档；860 负责说话人绑定。离线稿是事件提取的唯一来源。

## 验证边界

自动测试只替换 `request` 和 `fetch` 外部边界，运行同一 TTL、状态、解析及错误规则，全部使用合成资料。11/1 本卡两份合成材料的真实调用、结果域名/HTTPS 已验证，记录如下；873/859 的实际内容探测、业务授权和持久化联测仍归对应卡，旧的六十分钟实验不作为本实现的验收结果。

协议于 2026-10-25 只读核对：[CreateTask](https://help.aliyun.com/zh/tingwu/api-tingwu-2023-09-30-createtask)、[GetTaskInfo](https://help.aliyun.com/zh/tingwu/api-tingwu-2023-09-30-gettaskinfo)、[转写结果字段](https://help.aliyun.com/zh/tingwu/voice-transcription)。API 版本 `2023-09-30` 与 ACS3 签名由上级 HTTP 适配器负责。BOW-865 / PR #92 的 HTTP 与实时模块已随 main `37f987dd019cc2f10f25346301dc83244aa7837b` 合入，本卡仅交付 `offline/`。

历史组合验证使用 main `387ad10`、本卡离线候选及固定 #92 head `1abcf717d7251593ea73a3e34efbe683ab13b4be` 的临时 HTTP 源码与测试；该验证只能证明当时组合，临时依赖随后完整移除。最终独立检查以包含 #92 的已合 main 为基线，使用仓库内正式 HTTP 与实时模块，不再依赖临时文件。`check`、e2e、visual 的最终结果与受检 head 在 PR 中分别记录，历史组合结果不替代独立分支结果。

## 11/1 音频与视频真实验收

实际执行提交 `f0652acbc70a4082f5c4b1420f4a88a79dc0abf2`：原 PR #264 普通合入 main `01859d4`，直接复用已合 BOW-856 的唯一 S3 来源签名，不改 Kodo、HTTP/realtime 或共享入口。离线回归：听悟/Kodo 143项通过，其中 offline 58项；offline 全部4个生产文件行98%、分支94.06%。类型、范围格式/ESLint和边界检查通过。当前 PR head 的 CI 与 Claude 复核单独记录，不沿用旧 head 结论。

| 样本                  | 独立探测                                                                                             | 真实返回                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `mentor-note.wav`     | BOW-896 `9533f643` 的固定合成旁白；16kHz / mono / PCM16；649,586字节，20,298.188 ms                  | Task `8653d3…5cb6`；COMPLETED；结果20,298 ms，说话人编号1，两句 |
| `synthetic-video.mp4` | 同一完整旁白封装 H264 纯色画面 + AAC 音轨；138,613字节；容器20,280 ms，音轨20,224 ms；独立解码非静音 | Task `b8ae87…5635`；COMPLETED；结果20,280 ms，说话人编号1，两句 |

- 两样本分别只调用一次 CreateTask，未知结果不会重交；原始 MP4 本身上传并提交，不以本地提取音轨替代视频。两对象上传/stat/S3 GET 的长度与 SHA-256均通过。
- 2026-11-01 06:48:56 / 06:48:57 UTC 提交，06:50:31 UTC 查询时均已完成；06:52:13 UTC 经原客户端下载结果200并解析。先前按官方旧示例配置的 origin 拒绝了下载，核实实际生产 origin 后只重新查询/下载原任务，没有新建任务或改生产校验。
- 实际逐句定位：音频 `[0,12382]`、`[12392,20280]`；视频 `[0,12380]`、`[12385,20199]`，均在原件时长内。逐词锚点「重复提交后输出只有一份」分别为 `[9500,12382]`、`[9520,12380]` ms；固定夹具参考为 `[9671,12431]` ms。毫秒单位依据官方转写字段说明，保留实际偏差。
- 两份实际全文一致（SHA-256 `6eb08e009ef3b5cbbb5c4e592afc2dddcb42a4e1c86b094d672a78b5c26e1364`），但将演示姓名「谷嘉树」识别为「古家属」；不纠正、不从预期文稿补词，不据此声称识别无误或证明多说话人能力。说话人编号不绑定员工。
- 本轮没有人为发失败付费任务；错误分类、不可重提的提交未知结果与严格下载拒绝由离线反例验证。未启画面/PPT、摘要、翻译或其他模型算法。
- 确认两个任务已终态且原始/规范化转写证据已本地归档后，仅删除本轮两对象，删除200、stat612确认不存在。凭证只在验证进程 source 指定文件，未记录值、对象 key 或完整签名 URL。详细请求回执与材料摘要见 [GitHub #49](https://github.com/bowenQT/QTalent/issues/49)。
