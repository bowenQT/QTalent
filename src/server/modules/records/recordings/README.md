# BOW-859 归档录音的离线处理流程

本目录和 server/usecases/recordings 实现可注入端口的独立流程，不包含生产数据库适配器或 worker 注册。输入固定为 873 的 29e09ffaf4cee345329deb8df054ec5ab75da6bf（UploadDispatch / readValidatedUpload v1），以及 857 的 d354b608956db9d31fe60778ad30714ba16bb3bd（离线三方法协议）。873 的旧 897 合同前置和主线 917 通过普通 merge 保留来源。本卡不修改这些前置文件。

## 已实现的流程

1. 上传完成的原件身份和 job 必须一致；实际媒体解析端口返回该版本字节的摘要、字节数、格式与可信时长。只接受旧 858 的 MP3 / M4A / WAV / AAC 入口，不用文件名、上传声明、配额字符串或默认 0 生成媒体或集合事实。
2. 在短事务中持真实任务/attempt 与集合锁，读取当前账号、节点关系、成员、原件版本和绑定修订。下载、签名、提交、查询和结果写入之间重复核验；外部调用不占数据库事务。已发出的请求无法撤回，撤权或取消会阻止其结果进入整理。
3. 在提交前持久化 reservation，以稳定 operation key 调用听悟离线协议。同 job/attempt 的认领有显式执行租约：未到期重复投递忽略，到期后在原锁内换 claim 接管。旧 attempt、旧 poll 序列不重提。提交结果不确定且没有 task ID 时失败关闭；已知 task ID 时只查询原任务。每次投递至多查询一次，后续通过有界队列调度，不在 worker 里循环等待。
4. 离线结果产生不可变转写版本和逐句片段，每段指向归档原件版本及原始毫秒范围。拒绝零长、负数、越界或错误 task 的引用；不靠补时间或按文字去重修复结果。保留重叠的不同句子，不把供应商 speaker ID 当人员 ID。
5. 绑定端口须返回本版本所有片段的当前解析结果。只把 pending / deferred 歧义片段送入待核对；bound / irrelevant 不入队。needs_review 对应媒体任务的 awaiting_manual，不能映射成 partial。
6. 绑定恢复同时核对 BOW-860 已提交的恢复 ledger、当前绑定修订、转写版本和 job/attempt，不信客户端的“全部完成”。恢复复用既有离线版本，不再发起 ASR。只有所有片段均有明确处理时，按 offlineTranscriptInputSchema 将引用交给 845；这里不写正式事件、评分、确认或档案，也不声称 845 已处理完成。

本地取消没有调用供应商取消 API。迟到的同 attempt、同 claim task receipt 可保留用于核对，但不会恢复处理；旧 attempt 或已经被接管的旧拥有者均不允许写入。进程在 reservation 后崩溃、且无法确认 task ID 时需要人工/供应商查证，不能直接清 checkpoint 重提。生产适配器必须在新的 attempt 中保留此防重复事实。

## 首审修复：崩溃认领的恢复

私有 run 只增加 claimExpiresAt，复用原 claim 作为拥有者栅栏，不创建另一套 attempt、调度平台或 producer。claim 保留最后一次拥有者；claimExpiresAt:null 表示租约已释放，不能再用 claim 是否为空判断活跃。保留该栅栏可以在本地取消后记录同拥有者回执，同时拒绝接管前旧执行的迟到结果。

- createRecordingProcessor 必须显式提供正整数 claimLeaseMs 和 RecordingPorts.now()。沿用 jobs/service 的服务端 UTC 时间注入方式，now() 在持锁后读取；生产必须使用一致的真实执行时间，不能使用客户端时间或 createClock 的 demo/test 固定业务时间。当前权限的业务时间仍由原有上下文负责。无效时钟、缺失/损坏的租约元数据、复用的 claim 标识均拒绝，不推测为已过期。
- 在租约截止时间之前，重复投递仍忽略；到截止时间即允许接管。每个检查点仅续租尚未到期的当前拥有者，不能续活已过期或已被替换的 claim。取消和撤权检查优先于租约拒绝；已取消/失败/交给整理的状态不被旧执行恢复。
- 认领后、reservation 前崩溃：接管后重新检查归档与权限，只提交一次。reservation 后无 task ID：接管后到达 submission_unknown，不能再次 CreateTask。已有 task：只查原 task；已有持久转写：复用同一版本，不再查询或插入副本。
- 新拥有者接管后，旧执行的成功、失败、转写与 task receipt 都不能改它的 run。没有接管时，过期的同拥有者只可保留已知 task ID 作为核对元数据；业务处理必须由后续有效租约恢复。该行为不等于外部请求被撤销。
- 租约期限必须由生产组合按单次 I/O 上限与唯一 pg-boss 的过期/重投安排确定。本片没有持久调度器或自动唤醒：生产必须保证崩溃后的投递发生在租约到期后；不得提前投递、收到 ignored 后永久确认掉唯一恢复机会，也不得靠内存 timer 充当持久恢复。配置与真实重投仍是下述 X1/唯一 worker 的接线验收项。

回归使用真实处理流程留下的非空 claim，再暂停旧执行、推进独立执行时钟并重投，未通过把 claim 清空模拟崩溃。先在原 f67329f 上复现三个恢复窗口及撤权失败，再修复验证；租约内重复、恰到期、并发接管、旧回执/旧失败、已知 task、已提交转写、租约续期与时钟损坏均有反例。

## 859 → 860 的清单与首次状态

完整输入是已持久转写版本的全部 fragments：每段含 fragment/source、reviewItemId、providerSentenceId 和可空的 providerSpeakerId，同时携带独立 transcript/original 版本。providerSpeakerId:null 仍保留在清单、待核对与恢复验证中，不会被过滤；未识别项在旧 SpeakerItem DTO 的必填 speakerId 中用本片段 ID 作待核对 key，这不表示识别了说话人，也不能据此跨片段合并或绑定到人员。

首次 pending 行和当前授权候选人由 859 后续持久适配在存转写时生成；860 消费这份 inventory、记录实际人工绑定/无关 ledger。loadBindings 的生产适配只能依该版本/修订的 ledger 解除 null 片段歧义，不能自动认人。859 的适配联验须证明首次 null→pending 且不整理，860 的联验须证明真实人工 ledger→恢复，两者尚未生产验收。

loadBindings 少任何片段或重复片段都会失败，不会据残缺清单宣称全部完成。原件整体授权仍需 837/873 的完整分类投影，转写片段完整不等于整个原件已获播放许可。

## 必需的生产接线

- RecordingPorts.transaction：Read Committed 的原生短事务，和 873 / 846 共用 quota 锁、当前成员与节点写权限，锁后读取 BOW-860 绑定修订及恢复 ledger；saveRun 原子保存 claim/claimExpiresAt 和原有 run，同事务投影正式 media job 状态。旧存储没有期限字段时必须显式迁移/核对，不把 undefined 当释放或过期。缺少上下文即拒绝，不提供 allow-all / draft / 0 默认值。该私有字段的最终持久映射/迁移交 X1，不在本片生成。
- readValidatedUpload 只提供历史归档事实，不是永久授权；不复制其内部上传表或创建第二份原件。inspectAudio 需通过真实授权读取该不可变版本，解析媒体时长并重算摘要/长度。当前仅注入假实现验证，尚未提供媒体解码器和真实 Kodo 读取。
- prepareSource 使用既有 Kodo 能力签发；临时 URL / object key 不进入公开任务结果、前端、错误或日志。11/1 所有者在 #248/6551983878 决定沿用 856 唯一 S3 预签名实现；本轮仍固定旧客户端输入，未做真实来源/听悟调用，不绕证书、不新增签名器或资源，后续消费 856 稳定输入再联验。
- insertTranscript / 待核对数据 / 任务 checkpoint 的持久表与最终迁移、873 / 837 完整来源授权投影、播放短链和逐句定位页面仍待接。
- enqueuePoll / enqueueShaping 必须使用同原生事务、852 的唯一 producer / outbox；jobs/recordings.ts 只导出严格 payload、固定 queue 和 handler / dispatch 工厂，不注册 worker，不另起 producer。生产恢复 job 与 BOW-860 的 ledger 必须一致。租约后的崩溃重投由这一处持久队列保证。
- MP4 在 857 客户端可用，但 873 的旧七格式应用入口尚不接受 MP4；897 新材料 lane 的 video 分派需独立接入，不伪装 audio。

共享接线请求和权威字段答复见 #248 评论 6548144838、6548172004、6548237650。真实播放、真实转写、PG/事务隔离、845 整理和人工确认的端到端验收尚未运行，整卡保留未完成。

本轮尝试普通同步 main 5c053a6（含已合 897/e446）时，在共享 record.ts、materials.ts、materials.fixtures.ts、materials.test.ts、material-review.ts 冲突，已原样中止、保留 f67329f 输入并登记 #248/6553620929。没有自行选共享 blob 或宣称已对齐 main；稳定私有修复交回后由 X1 统一同步继承 873/897，再复验完整组合与 CI。

## 验证边界

policy.test.ts 验证来源、时间和绑定规则；usecases/recordings/processing.test.ts 用串行内存事务、可控执行时钟及假供应商验证竞态和流程；jobs/recordings.test.ts 验证 payload 和原 executor 委托。测试使用化名内容及 .example.test 的本地签名能力，不访问网络或加载凭证。内存回滚、租约接管和 executor 身份一致均不构成真实 PostgreSQL、pg-boss 重投或生产原子性证据。
