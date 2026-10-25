# 上传、集合与原件读取（BOW-873）

[SDD 与独立交叉评审](https://linear.app/bowenzhong/document/bow-873-sdd-v02-上传校验与原件授权读取-cdf1289eb171) · [PR186](https://github.com/bowenQT/QTalent/pull/186) · [任务65](https://github.com/bowenQT/QTalent/issues/65)。本卡仍是 Draft：实际记录写策略/保存 ledger、完整来源投影、处理器与公共路由尚需各责任方接线，不能把依赖组合验证当作已在 main 完成。

## 已有入口

- `createRecordCollectionService`：`create(accountId,{target,operationId})` 为新 people 记录签发服务器 UUID；同账号/operation 幂等，同键异目标冲突，重放仍检查当前写权限。target 规范化后不可变。它只是附件集合/配额容器，不承接 SBI 草稿、事件或保存状态。
- `collections.resolveWriteTarget(accountId,{recordCollectionId,target},tx?)`：真实表查集合，未保存时只允许创建者；已保存时依据846 ledger的 eventIds及反向映射解析事件别名。一个集合允许产生多个事件，没有 eventId UNIQUE，也不猜 people→event 关系。每次调用835/846当前写策略；creator不授予永久读取权。
- `createUploadService({store,storage,policy,...})`：`request`、`complete` 消费媒体合同。客户端不能指定账号/key，不能以人员集合或 client count 代替记录身份。凭证精确到对象、大小/MIME和五分钟；intent完成窗口最多24小时且不超过集合期限，续签不扩大范围或无限延长 intent。已完成事实的授权重放不因上传窗口到期而被改写。
- 完成只把 receipt 当通知，独立stat存在/长度/MIME，消费实际字节并流式计算SHA256、有界头尾格式鉴别，再stat确认对象未漂移；供应商etag不是SHA256。外部读取在事务外，提交前重查权限、期限与revision；原件、版本、对象映射、完成账本和dispatch同事务。这里不生成片段、解析版本或人工确认时间。
- `collections.release(accountId,{uploadId,operationId,expectedRevision})`：仅未保存集合的创建者在当前写权限下移除成员；同配额锁、revision及幂等账本释放slot，不删除原件/来源历史，不声称撤回外部上传或取消处理器。已保存集合拒绝直接移除；改原话/撤销后的阶段必须由846 ledger如实提供。移除后的旧complete被拒。
- `readValidatedUpload(store,{uploadId,originalVersionId})`：只返回匹配已提交完成的验证事实；`ValidatedUpload`为原件/版本/job身份、purpose/filename/target/account/quotaScope及`object:{objectKey,byteLength,mediaType,sha256,etag}`。它不是永久任务授权；worker仍核对jobId/purpose、当前授权与业务成员状态。没有fragment/parseVersion输出，原件移除出当前集合也不会被删除。

格式探测不是解码器：TXT全流严格UTF8；PDF头尾、DOCX中央目录必需部件、WAV/MP3/M4A/AAC容器签名。有界窗口为128KiB，超大ID3/中央目录无法确认时拒绝，不能据此声称所有合法容器均可解析。扫描件/损坏文档的解析结果由866提供，禁止以空正文冒充成功。

## 原件与请求边界

`createOriginalReader` 的 `grant` 接真实片段+版本，或原件ID+版本；`open` 接随机ticket及HTTP Range。原件身份先与已验证对象/完成版本匹配，不能拼接另一个原件。ticket为32随机字节，只存SHA256，绑定当前账号、原件/版本及可空片段，最长60秒；不造占位fragment、不发Kodo读取URL。请求中的range在未带HTTP Range时作为默认读取范围；两种路径始终要求整份原件已授权。

`createOriginalAuthorizer(load)`复用主线`readTalentSource`，对该版本所有真实来源检查当前权限。`load`须由837/859/866权威投影给出完整分类事实`complete=true`；原件身份读取还须提供真实originalId。未解析/未关联/未决内容、重复身份、无来源或任一隐藏片段均失败关闭。可见一个引用不能读整份对象，Range也不能绕过。

`createUploadHttpHandlers`提供POST申请/完成与GET原件的实际Request→Response边界；校验同源、会话和有界JSON，结果经媒体schema验证。匿名401、越权403/404、冲突409、依赖失败503分开；只返回白名单原因，保留合法解析的失败输入，不泄漏上游错误。读取必须审计成功后才返回流；审计只记ticket摘要，不记原始能力。流错误/取消不伪装成功，使用private/no-store、nosniff及安全文件名。

`server/queries/upload-runtime.ts`已实现无singleton的应用组合：真实PostgreSQL store、集合服务、上传/读取服务、HTTP边界，复用现有`jobAccount`（Access+应用会话）和`recordAudit`。构造不连接数据库、不启动队列、不配置或读取Kodo key；调用方显式注入storage、当前业务策略和唯一producer的dispatch。测试fake仅在tests/fixtures，底层复用已合createFakeKodo。

## 父需串行接的精确接口

`createUploadRuntime`需要以下服务器依赖；没有allow-all或fake生产默认值：

1. `collectionPolicy.canWriteTarget(accountId,target,tx)`：835/846真实记录写策略，使用`tx.executor`加载同一事务的当前授权；不能用人才读取或`canConfirmOwnScore`代替。
2. `collectionPolicy.loadBinding(collectionId,tx)`：846保存ledger，返回`{state:'draft',externalAttachmentCount}`或`{state:'saved',eventIds,externalAttachmentCount}`；依赖不可用时抛错，不默认draft/0。externalAttachmentCount只计算本集合不由upload intents代表的真实成员。
3. `collectionPolicy.collectionForEvent(eventId,tx)`：846 ledger的权威反向映射。缺映射拒绝，不能另造配额桶。一次记录保存只绑定一个集合，所有upload归该集合，附件并集≤10；改原话/撤销保留集合ID。
4. 846保存/撤销事务在核对成员、解析状态和写ledger前调用`lockUploadCollection(nativeTransaction,id)`。该入口与grant/release使用完全相同的quota锁，防止保存/移除竞态；它不授予写权限。846还须拒绝released、未完成、未解析或跨集合的上传，不能仅使用归档事实getter当作保存许可。
5. `canReadOriginal`：用`createOriginalAuthorizer`对接837的完整版本来源投影和处理器完整分类状态，不复制授权算法；未知内容不准播放。
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

## 当前验证范围

当前本地已正常merge main dd34dd2，包含#94/#77、837读取实现、正式媒体合同#112与Kodo修复#164；媒体临时overlay已移除，当前消费者直接使用已合合同。工程参照按仓库manifest451ecec准备78文件，种子data摘要不变，本卡没有原型/前端净改动。

PR202是用户新指定的P0合同依据，当前未合。最终Source的originalTitle/recordedByName与权限由837/838集中适配；873沿用其权威投影和共享授权，不自行补空名字或复制权限。等待父提供整合SHA后验证该组合，不能将当前main结果说成202已适配。

- 上传、代理、集合创建/移除、新读取身份等按行为Red→Green推进；包含匿名/范围外HR/导师敏感片段、混合人员、撤权、伪通知、大小/MIME/内容不符、幂等、quota及range。
- 精确2GiB合成流以复用1MiB块验证全长及SHA256，对照独立OpenSSL golden；不分配2GiB文件缓冲。这仅证明873校验边界，不代表浏览器/真实Kodo上传已支持。
- 真实PG17.6只应用已合迁移，独立随机_test库的四项事务锁/提交/回滚测试通过；完整持久adapter六项测试已准备，当前因四表迁移未发布而在beforeAll失败，六项未执行不计通过，也没有用临时DDL替代。
- 当前main dd34dd2加本卡工作树的全单元115文件/1106项、全格式、lint/边界、类型及标准Next生产构建通过。全单元不含PG，也不代表统一覆盖率已过；e2e/visual与完整PG门禁尚待持久接线后执行。当前head与CI结果以PR正文为准。

2GiB产品上限保持；已合Kodo grant的1GiB仍是adapter缺口。873直传只调用grant，可由856先扩精确grant上限并验证现有v2浏览器分片；buffer式server multipart的1GiB/256片限制另行处理，不能只调873参数冒充能力。已只读核PR164，不重复修复。没有真实Kodo/模型/业务API、实际key或部署；最终父合并。
