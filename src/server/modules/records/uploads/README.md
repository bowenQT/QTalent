# 上传与原件代理核心（BOW-873）

[SDD v0.2 与独立交叉评审](https://linear.app/bowenzhong/document/bow-873-sdd-v01-上传校验与原件授权读取-cdf1289eb171) · [任务 #65](https://github.com/bowenQT/QTalent/issues/65)。本目录是可注入的核心，**尚未接应用 actions/queries/HTTP 或真实处理 jobs，不是整卡完成**。

## 入口与当前行为

- `createUploadService({store, storage, policy, now?})`：`request(accountId, input)` / `complete(accountId, input)`。`accountId` 只能来自服务端已验证的会话，不可从客户端参数取。输入严格消费 PR112 的申请/完成 schema。
- `UploadPolicy.resolveWriteTarget` 每次重载记录写权限并返回稳定 `quotaScope`。不得以读权限代替写权限，也不得以人员集合或事件目标代替一条记录。`externalAttachmentCount` 是该集合已存在、但没有对应本目录上传 intent 的附件数；事务内从权威记录表加载，不能取客户端 count。跨账号同集合共用 quota 锁；本目录再计入已完成和有效的预留，总计最多十个。
- 申请由服务器生成 UUID 路径，Kodo 签发精确对象、大小/MIME与五分钟期限。intent 有二十四小时的完成窗口；相同 operation 与相同 payload 可在窗口内重新授权续签同一个 key，不延长 intent。已完成/过期的申请不能再签上传凭证。
- 完成忽略客户端“成功”暗示，独立 stat、读取字节、流式长度/SHA256和有界头尾格式探测，再次 stat 检查对象漂移。供应商 etag 和本地 SHA256 分开保存。外部读取在事务外，提交时重读写权限、期限、revision。原件、版本、对象映射、完成账本与 `dispatch` 同一事务；重放先重验权限，任何新版本/入队不重复执行。
- 格式鉴别是有界容器检查，不承诺完整解码或可提取正文。TXT 全流严格 UTF8/控制字符检查；PDF 头尾、DOCX 中央目录必需部件、WAV/MP3/M4A/AAC 签名。当前有界探测对头部超过 128 KiB 的 MP3 ID3、超过窗口的 DOCX 中央目录明确拒绝。扫描件仍由 BOW-866 返回 `unsupported/scanned`；损坏容器由后续解析/转写返回真实失败。这里不实现文本提取、OCR、音频解码。
- `createOriginalReader`：`grant(accountId, sourceReference)` 返回六十秒应用代理路径；`open(accountId, ticket, rangeHeader?)` 返回 `Response`。ticket 为随机 32 字节，只保存 SHA256，绑定账号和真实引用，每个请求重新授权、检查安全时钟和原件完整性。支持单个 `bytes=start-end` / `bytes=start-` 范围；拒绝多个范围、后缀范围和非法整数。流错误和取消不伪装成功，`private, no-store` / `nosniff`，前端不接收 Kodo URL/key。
- `createOriginalAuthorizer(load)` 复用主线 `readTalentSource` 算法，对整个版本的所有来源检查当前授权。`load` 必须由 BOW-837 的权威投影提供完整、已分类的来源集合及 `complete=true`；未知范围、未关联/未决片段、其他隐藏片段都不能给 true。只授权一个引用不能读取整个对象，即使请求的是 Range。未解析上传没有公共片段，不生成占位引用。

核心不提供默认真实配置、全局 singleton、授权 allow-all 或内存生产 store；fake 只在 `tests/fixtures/upload-fake.ts`，底层复用已合 `createFakeKodo()`。

## 父协调的精确接线

1. `createPostgresUploadStore(db, dispatch)`：`dispatch(tx, {purpose,uploadId,originalId,originalVersionId,accountId,quotaScope,target}) -> {jobId}`，其中 audio 进入 BOW-859，attachment 进入 BOW-866。必须使用传入 `tx` 原子持久入队；不得在此目录另造852的 lazy producer / worker 注册。
2. `resolveWriteTarget(accountId, target, transaction?)`：组合835/846责任方真实记录写策略和稳定记录集合；有 `transaction.executor` 时用它加载同一事务的当前授权与外部附件计数。不存在正确集合或策略就拒绝，不能以假授权作为生产 fallback。
3. `createOriginalAuthorizer(load)` 的 `load(accountId, originalVersionId, transaction?)`：父串行接837的来源投影；包括全部版本内容及事件/参与者/敏感性质。`complete` 必须由服务端完整分类事实产生，不能由请求布尔值提供。
4. 服务端专用 upload actions、source query 和 `GET /api/uploads/original?ticket=...`：每个入口先按现有 Access+应用会话认证，调用核心并做安全错误映射；GET 把当前请求 Range 传 `open`。真实短链请求路径目前未注册。敏感读取审计由应用入口串行接现有 audit。
5. 在上述依赖可用后构造本目录服务，将已合 Kodo 实例作为 `storage` 显式传入；不新增 env 或 singleton。真实 key、网络、部署不在本卡本次授权内。

## Schema 所有权与迁移顺序

本卡唯一新增 `uploads/schema.ts` 三表：`records_upload_intents`、`records_upload_objects`、`records_upload_read_tickets`。原件/版本沿既有 records 表；不修改846拥有的 `records/schema.ts`、write/save-state，或837 person-data/投影。

- intent 维护账户/operation 唯一、payload fingerprint、可信记录集合、精确对象路径、申请声明、有效期、revision和完成结果。字节用 bigint，保持 2 GiB 边界有效；完成三字段一致性有 CHECK。
- object 以原件版本为 PK/FK，upload/key 唯一，保存字节数、MIME、本地SHA256、供应商etag。
- ticket 只存随机能力摘要、账户、片段/版本与到期时间，复合 FK 验证真实片段/版本一致。过期 ticket 不再读；清理可由父现有维护入口按 expiry 实施，不提前注册 worker。

**本 PR 不含迁移。** 父先在 PR94 的 `0002_cold_secret_warriors` 之后协调唯一生成者，从当时最新 main 原生执行 `pnpm db:generate` 并复验；不得手写SQL、改0000/0001或抢占迁移编号。迁移前不启用此 store；真实 PG 的并发/回滚/FK 验收仍 Pending，不把测试 fake 当 PG。

## 依赖与已知阻点

- PR112 固定 `2397ad13d577e79bba4824fc691d62ec013ed5d2` 仍 Draft/前端消费评审 Pending；PR77 sources `63af7eaddb6da8ea59a59cb361442f537f260ad1`、PR94 jobs `a9da11e416c158d94527fc47ce161f0fba6ecf42` 未合。组合测试临时复制三份合同，不提交，也不称已在 main 可用。
- PR112 完成成功强制 `source`，上传完成尚无解析片段。本核心返回真实 `source:null`；合同责任方须允许 null 并修订 refine，之后才能适配公共成功 DTO，禁止强转/伪造 fragment。
- PR112 没有稳定 record collection ID。`quotaScope` 必须来自可信上下文；公开合同需责任方协调，不用 targetKey 冒充。
- 产品上限 2 GiB，当前已合 Kodo grant 上限 1 GiB。核心默认如实对超过 adapter 能力的申请报 `unavailable/adapter_limit`，不暗降产品上限。需856协调后传准确 `adapterMaxBytes`，不能只提高参数绕过供应商能力。
- 已只读检查 PR164 `375a4cb00a7650f008a95d2d01dc3ab7349c3a91` 的真实 diff（returnBody、mimeLimit与源站规范化）；本卡没有重写这些 adapter 修复。它仍 open，不代合、不联系外部 agent。
- 已按父更新 fast-forward 到 main `e96385ee187690946a2f2e32cde245601806ac6e`，工程参照按 manifest `1f10b5e` 准备76文件，种子两个data摘要不变。没有本卡原型改动。

## 验证口径

上传11项、原件代理9项均先 Red 再 Green；后续格式边界另先复现单字节 TXT 拒绝再修正。包含 merged Kodo fake 的原件字节/Range链路，以及现有授权算法下导师、范围外HR、混合人员、敏感片段、未知版本和不完整分类拒绝。

`playback-flow.test.ts` 另覆盖一秒合成PCM WAV：上传完成仍无来源，后续处理器分类夹具提供真实版本身份/0–1000ms引用；复用主线导师来源授权，经票据代理读出完全相同WAV字节。同版本增加隐藏人物片段后，旧票据与Range读取拒绝。它验证合成引用/授权/代理组合，不声称837档案查询和859处理器已上线。

当前固定三合同组合的全单元72文件/648项通过，后续新增播放组合与既有附件计数测试单列。类型、lint/边界通过；标准Next/Turbopack构建因PostCSS子进程绑定本地端口返回`Operation not permitted`而失败，提权后仍相同，未完成构建。远端独立head CI缺media/sources合同而失败，PG/覆盖率/build/e2e/visual未执行，不能把组合结果当远端通过。

这些不是真实应用HTTP、真实PG、真实jobs/处理器或真实Kodo验收。当前未接应用、未生成迁移，保持 Draft 与 `Part of BOW-873`，最终父负责合并。代码回退不能删除已有原件与任务历史，不自动DROP表。
