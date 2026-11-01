# Kodo 私有对象适配器（BOW-856）

依据：[SDD v1.1](https://linear.app/bowenzhong/document/6c820c5a9974)。本入口不做授权、不访问数据库、不建立 records 版本。BOW-873 调用前检查上传/读取权限；BOW-868 在收到完整对象回执后才能推进归档水位。

## 接入边界

- `createKodoClient(config, options?)` 显式创建真实协议客户端，创建本身不发请求。`config` 包含 `endpoint`（现有 S3 HTTPS origin）、`s3Region`（S3 区域；标准七牛 S3 域名可推导，显式配置须一致）、`uploadEndpoint`（所在区域上传 HTTPS origin）、`managementEndpoint`（资源管理 HTTPS origin）、`accessKey`、`secretKey`、`bucket`。密钥由调用方唯一服务端配置入口从环境提供，不能硬编码或放进客户端 bundle。此卡不新增公共环境变量或锁文件；环境命名与注入由协调卡接入，默认工程仍未启用真实集成。
- `options.fetch` 只替换 I/O 边界；`now` 为安全时钟，不使用演示业务时钟。单请求含响应体超时默认 30 秒，可设 1–120000 ms。stat 遇 429/5xx/网络故障最多三次尝试（50/100 ms 间隔）；对象 GET 和写请求不盲目重试。取消只中止本地 I/O，不承诺回滚供应商副作用。
- `issueUploadGrant({ objectKey, byteLimit, contentType, expiresAt })` 返回直传 token、精确 key、上传 endpoint 和到期时间。调用方必须生成不可猜测 key 并先授权。策略精确到 bucket:key、insertOnly、大小/MIME 上限，TTL 最长一小时，过期按秒向下取整；这是发给已授权浏览器的唯一上传凭证，不是读取能力。大小上限复用 `src/contracts/media.ts` 的冻结合同：2 GiB（2,147,483,648 字节），不是十进制 2 GB。
- 浏览器可按 `multipartVersion: 2` 使用官方 v2 协议直传与续传；凭证过期后必须重新向授权入口申请相同对象的受限凭证。UI、刷新授权与跨卡完成校验不在本卡。客户端声称完成不能创建原件版本，BOW-873 应 `statObject` 比较申请条件后决定。
- `statObject` 返回 key、byteLength、mediaType、etag。这里 etag 是供应商的完整对象 Qiniu hash，不能当作 SHA-256。
- `openObject({ objectKey, range?, signal? })` 通过内部 S3 SigV4 GET 预签名读取（五分钟），返回流、状态与白名单长度/MIME/范围头；`range` 是单个闭区间 `{start,end?}`。不返回 URL、不跟随重定向，拒绝被供应商忽略或错误的 Range。流消费中继续核对长度，错误/中断不伪装成功。调用方必须消费或取消流，并自行设置业务下载 Content-Disposition/缓存策略。
- 保留 `KodoClient.write/read`、`ObjectReceipt` 和 `createFakeKodo()`。`read` 为兼容小对象的缓冲读取，大对象使用 `openObject`。fake 只覆盖已有不可变写读接口，扩展协议测试使用合成 transport，不以 fake 代替真实验收。

## 完整对象与续传

`writeSegment({ objectKey, bytes, checksum?, contentType?, signal? })` 使用 insertOnly 完整对象上传；checksum 如提供必须为输入字节 SHA-256。上传回包需完整 key/hash，再 stat 核对长度与 Qiniu 全对象 hash，才返回兼容 `{key,byteLength,sha256}`。回执 SHA-256 从该已核验输入计算，不假称 Kodo stat 提供 SHA-256。同 key 同内容可恢复回执，不同内容 conflict，不覆盖。响应丢失先 stat，仍不明确则失败交调用方恢复。

`beginMultipart({objectKey,bytes,contentType,signal?})` 创建 v2 uploadId 并返回认证 checkpoint。调用方必须持久保存它；`resumeMultipart({...input,checkpoint,onCheckpoint})` 回查已完成对象，再检查上下文与列举分片，只复用同时匹配认证 checkpoint 的片。尚无分片时供应商的 `parts: null` 归一为空列表；缺少字段或异常类型仍拒绝。固定 4 MiB 分片（最多 512 片，与 2 GiB 合同一致），每个新片检查供应商返回 MD5，回调保存绑定 bucket/key/完整长度/SHA-256/uploadId/expiry/片摘要的 checkpoint。未被 checkpoint 确认的远端片会安全重传同一 partNumber。checkpoint 不含上传 token，但仍是服务器内部状态，不交前端或日志。

只有 completeMultipartUpload 成功且 stat 完整对象校验通过，或未知完成结果经 stat 确认后才返回回执。part ETag、uploadId、上传完部分字节均不是归档。失败保留最后 checkpoint 供恢复；过期且未成对象的上下文明确拒绝。恢复操作会重新签发最长一小时受限 token，但不延长 uploadId 本身寿命。若 token 在本轮完成前过期，调用方重新调用 resume，不能乐观确认。

## 听悟与用户读取隔离

`createTranscriptionSource({objectKey,purpose:'tingwu-offline',requiredRemainingTtlMs})` 只允许已配置 HTTPS origin 上的精确对象；调用方先确认完整性、用途与权限。所需 TTL 为 3 小时 + 至少 5 分钟提交余量，上限 24 小时。来源能力不把 URL 放在可枚举字段，JSON 和 Node inspect 均脱敏。

BOW-857 提交阶段调用 `takeTranscriptionSourceUrl(source,{now?,requiredRemainingTtlMs?})` 取 URL，默认检查剩余至少 3 小时。能力必须由该模块创建，伪造 DTO 或剩余 TTL 不足被拒；需 BOW-859 重新签发。代理读取和听悟来源能力共同调用私有 `s3-signing.ts` 的 SigV4 GET 实现；无额外存储客户端或 SDK。URL 使用既有 S3 origin，不替换虚拟域名中的 S3 空间别名（它可以不同于原生 bucket 名）。标准七牛裸 S3 origin 使用 bucket 路径式寻址；优先沿用已配置的虚拟域名。签名绑定精确 key、host、区域和实际秒级到期时间，保持重复斜线和 UTF-8 字节，拒绝反向/无效时钟、未知区域和穿越路径。严格验证 TLS，不跟随重定向、不降级 HTTP、不修改域名或证书。所有签名由本模块负责，不能另写签名算法。禁止序列化到前端 DTO、持久快照或日志；取出后的字符串仅发给已授权听悟提交请求，不能记录原始供应商异常/请求对象。用户读取始终走 BOW-873 授权代理。

## 验证与待验收

- TDD：精确上传策略/来源能力先 Red（缺少端口）再 Green；官方 SDK 对照发现 Content-MD5 必须为 hex，以失败断言修正；响应头后的超时先 Red，再补全体读取错误分类。
- S3 协议回归以 AWS 官方公开的已过期 SigV4 测试向量校验完整签名，并覆盖七牛区域/寻址、UTF-8/保留字符、自然秒级 TTL、非有限时钟和无效配置。该向量不是可用凭证；测试不会联网。
- 合成 transport 覆盖分片中断/续传/过期、伪造上下文、完整对象与 part ETag 区分、结果未知回查、冲突、代理 Range/头白名单/截断/取消/超时、签名不泄漏。fake/真实 transport 共享不可变 write/read 契约。没有真实网络调用或凭据。
- BOW-856 的真实手动上传、续传、摘要、私有读取与过期拒绝以 [#48 的验收记录](https://github.com/bowenQT/QTalent/issues/48) 为准；不得用离线测试或小对象结果声明真实 2 GiB 上传通过。BOW-873 的应用代理匿名/越权联测、前端 v2/续传刷新接入由对应业务卡完成。
- 真实验收须在所有者授权的受控环境中使用本轮唯一命名的小型合成文件；首片完成后中断，再恢复缺失分片并核对完整对象、读取 SHA-256、Range、匿名与过期拒绝，最后只清理自己的临时对象。S3 读取补验使用本轮独有的小型合成音频，先确认桶的只读元数据 `private=1`，有效 GET 和 Range 校验响应字节与 SHA-256；同一条短期 URL 在到期前读取成功，按自然时钟等待后必须拒绝。S3 接口本身要求签名，匿名拒绝不能单独证明桶的私有配置。记录受检 SHA、操作、脱敏 requestId/结果，不记录密钥、对象 key、checkpoint 或签名 URL。本卡不部署。

协议依据：[上传策略](https://developer-doc.qiniu.com/products/kodo/development-guidelines/security/1-put-policy)、[v2 初始化](https://developer.qiniu.com/kodo/6365/initialize-multipartupload)、[上传片](https://developer.qiniu.com/kodo/6366/upload-part)、[列举片](https://developer.qiniu.com/kodo/6858/listparts)、[完成对象](https://developer.qiniu.com/kodo/6368/complete-multipart-upload)、[QBox 管理签名](https://developer.qiniu.com/kodo/6671/historical-document-management-certificate)、[官方 JS SDK 上传](https://github.com/qiniu/js-sdk/blob/master/src/upload/resume.ts)。

S3 依据：[七牛访问域名与寻址](https://developer.qiniu.com/kodo/4088/s3-access-domainname)、[七牛 S3 鉴权](https://developer.qiniu.com/kodo/4093/s3-authentication)、[SigV4 查询签名与官方测试向量](https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html)。私有性仅通过 [官方只读 bucketInfo 接口](https://github.com/qiniu/go-sdk/blob/master/storagev2/apis/api_get_bucket_info.go)核对，不调整 bucket 权限。

## S3 读取错误分类（856 后续缺陷）

原 S3 有效读取、Range、匿名与自然过期验收继续有效，见 [#48/6554197593](https://github.com/bowenQT/QTalent/issues/48#issuecomment-6554197593)。其后 873 接线发现 HTTP400 被统一记为 `invalid_input`；本次只修 Kodo 的 S3 GET 非成功路径，调用方消费现有 `KodoError.code/status`，无需解析供应商 XML 或 Message。

| S3 GET 的真实状态与明确 Code                    | 现有安全错误                  |
| ----------------------------------------------- | ----------------------------- |
| HTTP400，`ExpiredToken`                         | `expired`，status400          |
| HTTP400，`NotSupportAnonymous`                  | `unauthorized`，status400     |
| HTTP400，其他/缺失 Code，包括 `InvalidArgument` | 原 `invalid_input`，status400 |
| 其他非成功 HTTP 状态                            | 原 HTTP 映射，不以 XML 覆盖   |

允许列表只包含本卡已审真实400样本中的两种 Code。解析仅接受完整、无歧义的 S3 scalar `Error` 信封；不展开实体、不从 Message 猜测。保留的错误体最多8KiB，先按声明长度拒绝明显超限，流式累计也检查实际长度；超限即取消，不相信含合法Code的截断前缀。重复字段、非预期/嵌套标记、畸形实体、非法UTF-8或读取失败仍按原HTTP分类。该保守识别器不作为通用XML解析器；不支持的形式继续失败关闭。

错误体读取服从同一请求的取消/超时，清理reader锁并请求取消流；取消hook自身的异常不进错误，也不拖住有界请求。最终错误只含既有安全code/status，不新增S3Code、原文、Message、key、URL或cause。成功200/206仍走原有字节与Range校验，正文看似XML错误也作为正常数据。原生上传、stat和分片API保持原有HTTP映射，不参与此解析。

本次验证完全离线：真实样本只引用已审Code/status，其余信封字段从零合成，不复用原始供应商错误体。没有重新读取凭证或访问供应商；原S3签名算法、TTL、域名、TLS和桶权限均不改。
