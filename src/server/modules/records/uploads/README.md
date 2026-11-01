# 上传、集合与原件读取（BOW-873）

[SDD 与独立交叉评审](https://linear.app/bowenzhong/document/bow-873-sdd-v02-上传校验与原件授权读取-cdf1289eb171) · [PR186](https://github.com/bowenQT/QTalent/pull/186) · [任务65](https://github.com/bowenQT/QTalent/issues/65)。本卡仍是 Draft：实际记录写策略/保存 ledger、完整来源投影、处理器与公共路由尚需各责任方接线，不能把依赖组合验证当作已在 main 完成。

## 已有入口

- `createRecordCollectionService`：`create(accountId,{target,operationId})` 为新 people 记录签发服务器 UUID；同账号/operation 幂等，同键异目标冲突，重放仍检查当前写权限。target 规范化后不可变。它只是附件集合/配额容器，不承接 SBI 草稿、事件或保存状态。
- `collections.resolveWriteTarget(accountId,{recordCollectionId,target},tx?)`：真实表查集合，未保存时只允许创建者；已保存时依据846 ledger的全部 eventIds及反向映射解析事件别名；即使客户端仍传 people，也逐个核对所有绑定事件的当前写许可，不能降级绕过已撤销的事件权限。一个集合允许产生多个事件，没有 eventId UNIQUE，也不猜 people→event 关系。每次调用835/846当前写策略；creator不授予永久读取权。
- `createUploadService({store,storage,policy,...})`：`request`、`complete` 消费媒体合同。客户端不能指定账号/key，不能以人员集合或 client count 代替记录身份。凭证精确到对象、大小/MIME和五分钟；intent完成窗口最多24小时且不超过集合期限，续签不扩大范围或无限延长 intent。已完成事实的授权重放不因上传窗口到期而被改写。
- 完成只把 receipt 当通知，独立stat存在/长度/MIME，消费实际字节并流式计算SHA256、有界头尾格式鉴别，再stat确认对象未漂移；供应商etag不是SHA256。外部读取在事务外，提交前在与846相同的 quota 锁下重查权限、期限、不可变声明与revision；原件、版本、对象映射、完成账本和dispatch同事务。这里不生成片段、解析版本或人工确认时间。
- `collections.release(accountId,{uploadId,operationId,expectedRevision})`：仅未保存集合的创建者在当前写权限下移除成员；同配额锁、revision及幂等账本释放slot，不删除原件/来源历史，不声称撤回外部上传或取消处理器。已保存集合拒绝直接移除；改原话/撤销后的阶段必须由846 ledger如实提供。移除后的旧complete被拒。
- `readValidatedUpload(store,{uploadId,originalVersionId})`：只返回匹配已提交完成的验证事实；`ValidatedUpload`为原件/版本/job身份、purpose/filename/target/account/quotaScope及`object:{objectKey,byteLength,mediaType,sha256,etag}`。它不是永久任务授权；worker仍核对jobId/purpose、当前授权与业务成员状态。没有fragment/parseVersion输出，原件移除出当前集合也不会被删除。

格式探测不是解码器：TXT全流严格UTF8；PDF头尾、DOCX中央目录必需部件、WAV/MP3/M4A/AAC容器签名。有界窗口为128KiB，超大ID3/中央目录无法确认时拒绝，不能据此声称所有合法容器均可解析。扫描件/损坏文档的解析结果由866提供，禁止以空正文冒充成功。

## 原件与请求边界

`createOriginalReader` 的 `grant` 接真实片段+版本，或原件ID+版本；`open` 接随机ticket及HTTP Range。原件身份先与已验证对象/完成版本匹配，不能拼接另一个原件。ticket为32随机字节，只存SHA256，绑定当前账号、原件/版本及可空片段，最长60秒；不造占位fragment、不发Kodo读取URL。请求中的range在未带HTTP Range时作为默认读取范围；两种路径始终要求整份原件已授权。

`createOriginalAuthorizer(load)`复用主线`readTalentSource`，对该版本所有真实来源检查当前权限。`load`须由837/859/866权威投影给出完整分类事实`complete=true`；原件身份读取还须提供真实originalId。未解析/未关联/未决内容、重复身份、无来源或任一隐藏片段均失败关闭。可见一个引用不能读整份对象，Range也不能绕过。

`createUploadHttpHandlers`提供POST申请/完成与GET原件的实际Request→Response边界；校验同源、会话和有界JSON，结果经媒体schema验证。匿名401、越权403/404、冲突409、依赖失败503分开；只返回白名单原因，保留合法解析的失败输入，不泄漏上游错误。读取必须审计成功后才返回流；审计只记ticket摘要，不记原始能力。Kodo GET 的状态、长度、MIME和Content-Range须与归档对象及请求范围一致，实际流按精确长度检查，短流/溢出都会终止并关闭。只转发经过核对的白名单响应头。流错误/取消不伪装成功，使用private/no-store、nosniff及安全文件名。

`server/queries/upload-runtime.ts`已实现无singleton的应用组合：真实PostgreSQL store、集合服务、上传/读取服务、HTTP边界，复用现有`jobAccount`（Access+应用会话）和`recordAudit`。构造不连接数据库、不启动队列、不配置或读取Kodo key；调用方显式注入storage、当前业务策略和唯一producer的dispatch。测试fake仅在tests/fixtures，底层复用已合createFakeKodo。

## 父需串行接的精确接口

`createUploadRuntime`需要以下服务器依赖；没有allow-all或fake生产默认值。`createNodeAuthorizedUploadRuntime`另要求显式业务时钟、锁后完整节点/主体事实，以及真实节点写策略和完整原件来源策略；不将读取权限代替记录写权限。节点选择不授予解析、模型或后续保存许可：

1. `collectionPolicy.canWriteTarget(accountId,target,tx)`：835/846真实记录写策略，使用`tx.executor`加载同一事务的当前授权；不能用人才读取或`canConfirmOwnScore`代替。
2. `collectionPolicy.loadBinding(collectionId,tx)`：846保存ledger，返回`{state:'draft',externalAttachmentCount}`或`{state:'saved',eventIds,externalAttachmentCount}`；依赖不可用时抛错，不默认draft/0。externalAttachmentCount只计算本集合不由upload intents代表的真实成员。
3. `collectionPolicy.collectionForEvent(eventId,tx)`：846 ledger的权威反向映射。缺映射拒绝，不能另造配额桶。一次记录保存只绑定一个集合，所有upload归该集合，附件并集≤10；改原话/撤销保留集合ID。
4. 846保存/撤销事务在核对成员、解析状态和写ledger前调用`lockUploadCollection(nativeTransaction,id)`。该入口与grant/complete/release使用完全相同的quota锁，防止保存/移除竞态；它不授予写权限。846还须拒绝released、未完成、未解析或跨集合的上传，不能仅使用归档事实getter当作保存许可。
5. `canReadOriginal`：旧来源用`createOriginalAuthorizer`，899节点图必须用`createNodeOriginalAuthorizer`消费固定899当前来源策略，旧入口发现节点事实即拒绝，不能回退到旧分配权限；两者均要求837完整版本来源投影及处理器完整分类，未知内容不准播放。
6. Kodo实例、trustedOrigin及`dispatch`由父/唯一配置方注入；实际upload/source actions、短链路由与来源播放字段由父串行登记。本目录不改共享index、worker注册或env，不另造852的lazy producer。

### 866/859冻结分派port v1

`UploadDispatch(tx,{purpose,uploadId,originalId,originalVersionId,accountId,quotaScope,target})->Promise<{jobId}>`。audio交859，attachment交866；必须以传入同一原生事务持久任务/入队，提交后才下载/处理。复用852的`getAppJobProducer(queue)`和`fromDrizzle(tx,sql)`，queue/payload由各处理器提供服务器常量，不能来自客户端。不复制供应商签名或另建producer。

worker使用上述`readValidatedUpload`，不直接读写uploads内部表，不重建原件/会话。objectKey只给server worker，不能进入前端DTO、公开job结果或日志；该getter复用现有上传表，无解析侧额外schema要求。

## Schema与串行迁移

本卡独占`uploads/schema.ts`四表：

- `records_upload_collections`：服务器身份、creator/创建operation唯一、不可变target/摘要、版本和上传期限；不存SBI或事件草稿，不建立单事件唯一关系。
- `records_upload_intents`：集合FK、账户/operation唯一、payload摘要、精确key、声明、期限/revision、完成和移除幂等账本；quotaScope与请求集合ID有一致性CHECK。计数排除released及过期未完成，已完成未移除仍计数。
- `records_upload_objects`：原件版本PK/FK、upload/key唯一、bigint字节数、MIME、本地SHA256和供应商etag。原件/版本沿用既有records表，不改846 schema。
- `records_upload_read_tickets`：随机能力摘要、账号、原件/版本、可空fragment、请求range和期限。非空fragment受复合FK约束，不用假引用填空。

**不含新迁移，不手写DDL或push schema。** 父在852→846之后从届时main原生生成873迁移并完整验证；不得改已合0000–0002或抢编号。过期/移除不删除已完成来源与历史；代码回退不等于数据回退，不自动DROP生产表。

## 29e09ff 历史接续与验证边界

本轮从原分支正常合入 main `5726fd5` 与897冻结 `0b20a913`，不修改合同。873旧 `UploadRequest` 仍只支持七种格式；897的 `materialUploadRequest`（含MP4/无人员材料）是独立契约，不能送入旧服务，也没有借选定节点自动获得外发许可。材料批次的独立持久化、状态/回执及新分派尚未接入，相关产品裁决没有在本卡擅自补定。

本轮重点回归：已保存集合的 people/event 别名均核全体绑定事件；完成与846共享quota锁；验证前后不可变声明一致；对象MIME/版本二次校验；代理GET元数据、精确流长度与关闭；节点完整事实和当前时间输入；旧授权不降级。PostgreSQL上传事务显式使用 Read Committed，防止连接默认 Repeatable Read 时等到锁仍读取旧快照。

真实PG的锁、等待后撤权、同事务回滚测试与单元测试分开记录。四表的最终迁移尚未发布，原始 `store.integration.test.ts` 保留缺表即失败的门禁；临时验证只能使用 `/tmp` 内原生生成的迁移和内容相同、仅迁移路径不同的测试副本，不能称为默认CI通过。准确受检SHA、命令、计数与覆盖率见PR本轮交接。

固定899 `96fa3aa` 的实际 `canEvaluateNode` / `readTalentSource` 与本轮节点组合已在离线化名事实下验证：本节点允许、跨节点/到期拒绝、整份原件含任一隐藏片段拒绝。该组合不等于生产835/846写策略和837投影已接通，也不验证实际数据库授权读取。

2GiB产品边界不变。上述29e09ff验证时856尚未合入，未进行真实Kodo/听悟/模型调用或部署。之后856的 `68943e6` 已合入main，唯一客户端已改S3预签名并完成有效GET/Range、匿名400/NotSupportAnonymous及自然过期400/ExpiredToken验收（#48/6554197593）；本卡只复用脱敏实证，不新建供应商对象，也不以这些网络证据冒充完整应用代理/播放接线通过。实际client联测用离线transport返回合成XML/字节，拒绝与正确分类不等于生产路由、派发或ASR已接通。

### S3私有读取错误接入

原29e09ff普通合main81e4fd时的共享契约冲突由X1在453ff27收敛，contracts与main逐字一致，uploads保留本卡291b3a1独占修复；作者再普通合固定460，没有rebase/强推或选择共享契约版本。

`readOriginalStorage` 只在原件读取的 stat/open 边界消费唯一856客户端的 `KodoError.code`，不按HTTP400猜认证、不在873解析XML或签名，也不新增SDK或重签/重试。已合68943e6的旧HTTP-only分类已用实际client重现两种400被误判。本轮普通组合856后续PR286固定 `460e009e72a8087d098e99eedd7c9587b38acaa0`：仅S3 GET的完整明确ExpiredToken→expired、NotSupportAnonymous→unauthorized；其他400（包括InvalidArgument、未知/缺Code、畸形/超限）仍invalid_input，其他状态与原生API不变。Code解析、8KiB上限与取消都由唯一856实现，873不复制。PR286的实际main状态须由合入门禁另核，当前固定组合验证不能代替依赖合入。

- provider unauthorized/expired 是服务器存储认证或签名依赖失败，503 unavailable；它不是用户会话，不能把它当用户输入错、提示重新登录或放宽整份原件权限。
- 唯一客户端明确 invalid_input/invalid_range 的坏参数保留400；not_found为404。超时、上游不可用、限流、完整性或未知错误为503，丢弃上游message/cause，不返回XML、对象key或签名URL。
- 应用匿名仍401，越权/归属不符/应用ticket自然过期仍404，并在访问存储前拒绝；读后权限/期限复核、完整版本全片段授权与精确流检查保持。流开始后出错只能终止流，不能伪装读取成功。
- 内部安全reason只描述存储认证、过期或不可用；HTTP响应继续使用既有白名单文案。读取成功并审计后才返回流，失败不审计原始能力或泄漏上游诊断。

### 859当前字段事实与最小后续窗口

当前 `UploadDispatch` 与 `readValidatedUpload` 的字段保持原有 v1：分派有purpose、upload/original/version、account、quotaScope、旧target；getter另有filename和已验证object的key/length/MIME/SHA256/etag。**没有可信durationMs、显式recordCollectionId或人员绑定修订。** 原生表保证quotaScope与集合ID一致，但消费者不应从任意quota字符串猜身份；上传intent或集合的revision也不是说话人/人员绑定revision。

getter是已归档版本的历史事实，不是当前处理许可。它自己开启读取事务，不能代替846/860同事务的成员/绑定核验。下一窗口应由873/846共同提供：持同一quota锁的当前集合身份、成员及权威绑定修订读取，随后以859任务事务校验当前许可和版本；可信时长由859实际读取已验证字节/媒体解析得到，再核对版本摘要与绑定，不写0或估算值。

当前audio分派仍只覆盖旧858录音格式，MP4不经此入口。857客户端支持MP4不代表应用已支持video上传；897材料lane的video分派需另行明确，不伪装成audio。859可显式注入缺失端口做假实现测试，生产唯一producer、worker注册、私有读取/播放/听悟任务仍待责任方接线和真实验证。该后续窗口不是本轮873扩围。

本轮下一步按真实责任接线（没有填默认值）：

1. 873/846在现有 `lockUploadCollection`、`loadBinding`、`collectionForEvent` 所属真实事务内核对集合与完整成员；getter/dispatch如需显式recordCollectionId应由该窗口明确提供，不能从任意quotaScope猜身份。
2. 846/860提供权威人员/说话人绑定修订与处理时当前许可；上传intent/集合revision不能冒充绑定revision，归档时的account/target也不能当当前权限。
3. 859从已验证原件字节实际媒体解析durationMs，并绑定originalVersionId/摘要；缺时长仍是缺口，不填0、估算值或把ASR最后一句时间当完整媒体时长。本轮不重跑模型、ASR或供应商对象。
4. 852唯一producer由应用组合方注入现有UploadDispatch，在传入原生tx内持久859/866任务；X1负责公共出口、队列/worker注册与路由。现有假dispatch仅是测试，不能当生产任务已接。
