# Kodo 私有对象适配器（BOW-856）

依据：[SDD v1.1](https://linear.app/bowenzhong/document/6c820c5a9974)。本入口不做授权、不访问数据库、不建立 records 版本。BOW-873 调用前检查上传/读取权限；BOW-868 在收到完整对象回执后才能推进归档水位。

## 接入边界

- `createKodoClient(config, options?)` 显式创建真实协议客户端，创建本身不发请求。`config` 包含 `endpoint`（私有对象 HTTPS origin）、`uploadEndpoint`（所在区域上传 HTTPS origin）、`managementEndpoint`（资源管理 HTTPS origin）、`accessKey`、`secretKey`、`bucket`。密钥由调用方唯一服务端配置入口从环境提供，不能硬编码或放进客户端 bundle。此卡不新增公共环境变量或锁文件；环境命名与注入由协调卡接入，默认工程仍未启用真实集成。
- `options.fetch` 只替换 I/O 边界；`now` 为安全时钟，不使用演示业务时钟。单请求含响应体超时默认 30 秒，可设 1–120000 ms。GET/stat 遇 429/5xx/网络故障最多三次尝试（50/100 ms 间隔）；写请求不盲目重试。取消只中止本地 I/O，不承诺回滚供应商副作用。
- `issueUploadGrant({ objectKey, byteLimit, contentType, expiresAt })` 返回直传 token、精确 key、上传 endpoint 和到期时间。调用方必须生成不可猜测 key 并先授权。策略精确到 bucket:key、insertOnly、大小/MIME 上限，TTL 最长一小时，过期按秒向下取整；这是发给已授权浏览器的唯一上传凭证，不是读取能力。大小上限 1 GiB 是当前适配器界限，不代表产品附件限制。
- 浏览器可按 `multipartVersion: 2` 使用官方 v2 协议直传与续传；凭证过期后必须重新向授权入口申请相同对象的受限凭证。UI、刷新授权与跨卡完成校验不在本卡。客户端声称完成不能创建原件版本，BOW-873 应 `statObject` 比较申请条件后决定。
- `statObject` 返回 key、byteLength、mediaType、etag。这里 etag 是供应商的完整对象 Qiniu hash，不能当作 SHA-256。
- `openObject({ objectKey, range?, signal? })` 返回流、状态与白名单长度/MIME/范围头；`range` 是单个闭区间 `{start,end?}`。不返回 URL、不跟随重定向，拒绝被供应商忽略或错误的 Range。流消费中继续核对长度，错误/中断不伪装成功。调用方必须消费或取消流，并自行设置业务下载 Content-Disposition/缓存策略。
- 保留 `KodoClient.write/read`、`ObjectReceipt` 和 `createFakeKodo()`。`read` 为兼容小对象的缓冲读取，大对象使用 `openObject`。fake 只覆盖已有不可变写读接口，扩展协议测试使用合成 transport，不以 fake 代替真实验收。

## 完整对象与续传

`writeSegment({ objectKey, bytes, checksum?, contentType?, signal? })` 使用 insertOnly 完整对象上传；checksum 如提供必须为输入字节 SHA-256。上传回包需完整 key/hash，再 stat 核对长度与 Qiniu 全对象 hash，才返回兼容 `{key,byteLength,sha256}`。回执 SHA-256 从该已核验输入计算，不假称 Kodo stat 提供 SHA-256。同 key 同内容可恢复回执，不同内容 conflict，不覆盖。响应丢失先 stat，仍不明确则失败交调用方恢复。

`beginMultipart({objectKey,bytes,contentType,signal?})` 创建 v2 uploadId 并返回认证 checkpoint。调用方必须持久保存它；`resumeMultipart({...input,checkpoint,onCheckpoint})` 回查已完成对象，再检查上下文与列举分片，只复用同时匹配认证 checkpoint 的片。固定 4 MiB 分片（最多 256 片），每个新片检查供应商返回 MD5，回调保存绑定 bucket/key/完整长度/SHA-256/uploadId/expiry/片摘要的 checkpoint。未被 checkpoint 确认的远端片会安全重传同一 partNumber。checkpoint 不含上传 token，但仍是服务器内部状态，不交前端或日志。

只有 completeMultipartUpload 成功且 stat 完整对象校验通过，或未知完成结果经 stat 确认后才返回回执。part ETag、uploadId、上传完部分字节均不是归档。失败保留最后 checkpoint 供恢复；过期且未成对象的上下文明确拒绝。恢复操作会重新签发最长一小时受限 token，但不延长 uploadId 本身寿命。若 token 在本轮完成前过期，调用方重新调用 resume，不能乐观确认。

## 听悟与用户读取隔离

`createTranscriptionSource({objectKey,purpose:'tingwu-offline',requiredRemainingTtlMs})` 只允许已配置 HTTPS origin 上的精确对象；调用方先确认完整性、用途与权限。所需 TTL 为 3 小时 + 至少 5 分钟提交余量，上限 24 小时。来源能力不把 URL 放在可枚举字段，JSON 和 Node inspect 均脱敏。

BOW-857 提交阶段调用 `takeTranscriptionSourceUrl(source,{now?,requiredRemainingTtlMs?})` 取 URL，默认检查剩余至少 3 小时。能力必须由该模块创建，伪造 DTO 或剩余 TTL 不足被拒；需 BOW-859 重新签发。所有签名由本模块负责，不能另写签名算法。禁止序列化到前端 DTO、持久快照或日志；取出后的字符串仅发给已授权听悟提交请求，不能记录原始供应商异常/请求对象。用户读取始终走 BOW-873 授权代理。

## 验证与待验收

- TDD：精确上传策略/来源能力先 Red（缺少端口）再 Green；官方 SDK 对照发现 Content-MD5 必须为 hex，以失败断言修正；响应头后的超时先 Red，再补全体读取错误分类。
- 合成 transport 覆盖分片中断/续传/过期、伪造上下文、完整对象与 part ETag 区分、结果未知回查、冲突、代理 Range/头白名单/截断/取消/超时、签名不泄漏。fake/真实 transport 共享不可变 write/read 契约。没有真实网络调用或凭据。
- 真实手动上传、续传、私有读取、过期拒绝及 BOW-873 匿名/越权联测均 Pending；前端 v2/续传刷新接入亦 Pending。不得用这些离线测试声明卡全部完成。
- 真实验收需另行授权与受控测试环境，使用小型合成文件，记录受检 SHA、操作、脱敏 requestId/结果，不记录密钥或签名 URL。本卡不部署。

协议依据：[上传策略](https://developer-doc.qiniu.com/products/kodo/development-guidelines/security/1-put-policy)、[v2 初始化](https://developer.qiniu.com/kodo/6365/initialize-multipartupload)、[上传片](https://developer.qiniu.com/kodo/6366/upload-part)、[列举片](https://developer.qiniu.com/kodo/6858/listparts)、[完成对象](https://developer.qiniu.com/kodo/6368/complete-multipart-upload)、[QBox 管理签名](https://developer.qiniu.com/kodo/6671/historical-document-management-certificate)、[官方 JS SDK 上传](https://github.com/qiniu/js-sdk/blob/master/src/upload/resume.ts)。
