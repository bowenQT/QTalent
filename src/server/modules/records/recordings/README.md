# BOW-859 归档录音的离线处理流程

本目录和 `server/usecases/recordings` 实现可注入端口的独立流程，不包含生产数据库适配器或 worker 注册。输入固定为 873 `29e09ffaf4cee345329deb8df054ec5ab75da6bf` 的 `UploadDispatch` / `readValidatedUpload` v1，以及 857 `d354b608956db9d31fe60778ad30714ba16bb3bd` 的离线三方法协议；873 的 897 合同前置和主线 917 通过普通 merge 保留来源。本卡不修改这些前置文件。

## 已实现的流程

1. 上传完成的原件身份和 job 必须一致；实际媒体解析端口返回该版本字节的摘要、字节数、格式与可信时长。只接受旧 858 的 MP3 / M4A / WAV / AAC 入口，不用文件名、上传声明、配额字符串或默认 0 生成媒体或集合事实。
2. 在短事务中持真实任务/attempt 与集合锁，读取当前账号、节点关系、成员、原件版本和绑定修订。下载、签名、提交、查询和结果写入之间重复核验；外部调用不占数据库事务。已发出的请求无法撤回，撤权或取消会阻止其结果进入整理。
3. 在提交前持久化 reservation，以稳定 operation key 调用听悟离线协议。重复投递、旧 attempt、旧 poll 序列不重提。提交结果不确定且没有 task ID 时失败关闭；已知 task ID 时只查询原任务。每次投递至多查询一次，后续通过有界队列调度，不在 worker 里循环等待。
4. 离线结果产生不可变转写版本和逐句片段，每段指向归档原件版本及原始毫秒范围。拒绝零长、负数、越界或错误 task 的引用；不靠补时间或按文字去重修复结果。保留重叠的不同句子，不把供应商 speaker ID 当人员 ID。
5. 绑定端口须返回本版本所有片段的当前解析结果。只把 pending / deferred 歧义片段送入待核对；bound / irrelevant 不入队。`needs_review` 对应媒体任务的 `awaiting_manual`，不能映射成 `partial`。
6. 绑定恢复同时核对 BOW-860 已提交的恢复 ledger、当前绑定修订、转写版本和 job/attempt，不信客户端的“全部完成”。恢复复用既有离线版本，不再发起 ASR。只有所有片段均有明确处理时，按 `offlineTranscriptInputSchema` 将引用交给 845；这里不写正式事件、评分、确认或档案，也不声称 845 已处理完成。

本地取消没有调用供应商取消 API。迟到的同 attempt task receipt 可保留用于核对，但不会恢复处理；旧 attempt 不允许写入。进程在 reservation 后崩溃、且无法确认 task ID 时需要人工/供应商查证，不能直接清 checkpoint 重提。生产适配器必须在新的 attempt 中保留此防重复事实。

## 必需的生产接线

- `RecordingPorts.transaction`：Read Committed 的原生短事务，和 873 / 846 共用 quota 锁、当前成员与节点写权限，锁后读取 BOW-860 绑定修订及恢复 ledger；`saveRun` 同事务投影正式 media job 状态。缺少上下文即拒绝，不提供 allow-all / draft / 0 默认值。
- `readValidatedUpload` 只提供历史归档事实，不是永久授权；不复制其内部上传表或创建第二份原件。`inspectAudio` 需通过真实授权读取该不可变版本，解析媒体时长并重算摘要/长度。当前仅注入假实现验证，尚未提供媒体解码器和真实 Kodo 读取。
- `prepareSource` 使用既有 Kodo 能力签发；临时 URL / object key 不进入公开任务结果、前端、错误或日志。真实私有来源的 TLS 阻点仍未解决，不绕证书，不发真实听悟任务。
- `insertTranscript` / 待核对数据 / 任务 checkpoint 的持久表与最终迁移、873 / 837 完整来源授权投影、播放短链和逐句定位页面仍待接。
- `enqueuePoll` / `enqueueShaping` 必须使用同原生事务、852 的唯一 producer / outbox；`jobs/recordings.ts` 只导出严格 payload、固定 queue 和 handler / dispatch 工厂，不注册 worker，不另起 producer。生产恢复 job 与 BOW-860 的 ledger 必须一致。
- MP4 在 857 客户端可用，但 873 的旧七格式应用入口尚不接受 MP4；897 新材料 lane 的 video 分派需独立接入，不伪装 audio。

共享接线请求和权威字段答复见 #248 评论 6548144838、6548172004、6548237650。真实播放、真实转写、PG/事务隔离、845 整理和人工确认的端到端验收尚未运行，整卡保留未完成。

## 验证边界

`policy.test.ts` 验证来源、时间和绑定规则；`usecases/recordings/processing.test.ts` 用串行内存事务及假供应商验证竞态和流程；`jobs/recordings.test.ts` 验证 payload 和原 executor 委托。测试使用化名内容及 `.example.test` 的本地签名能力，不访问网络或加载凭证。内存回滚和 executor 身份一致均不构成真实 PostgreSQL 原子性证据。
