# 文本附件解析核心（BOW-866，部分交付）

[SDD v0.3 与独立交叉评审](https://linear.app/bowenzhong/document/bow-866-文本附件解析-sdd-v03-3c8166c04ea0) · [PR189](https://github.com/bowenQT/QTalent/pull/189) · [批准依赖与许可证](DEPENDENCIES.md)。

本目录提供 TXT、DOCX 正文和文字型 PDF 的独立解析、真实来源片段、873 输入适配与独立解析任务。用户于 2026-10-25 17:12 UTC 明确批准两包；已从官方 npm 精确锁定 mammoth 1.13.0、pdfjs-dist 6.4.299，并用真实合成文件测试。**应用持久化、实际上传→解析→整理接线仍未完成，独立解析通过不代表业务可用。** 没有内存生产 store、模型调用、授权 allow-all、共享 worker/env 或迁移。

## 入口和定位

- `parseAttachment({version, content, limits, decoders?, signal?})` 接收已归档版本和只读字节流；`version` 包含 mediaId、originalVersionId、filename、mediaType、byteLength、sha256。流式检查实际长度、SHA256、资源预算；拥有每块字节，避免供应商复用缓冲区改变已验内容。超出解析能力是失败，不暗改 2 GiB 上传合同。
- TXT 严格 UTF-8，去一个起始 BOM，保留中文、CRLF、段内换行和原文。空行与 form-feed 分段，首尾空白不进入 excerpt。`paragraph: txt:pN:u16:start-end` 的范围相对于**去 BOM 后的完整原文**，UTF-16 起点含、终点不含；excerpt 就是这个范围的精确子串。没有物理页码，不补 `page:1`。
- parseVersionId 绑定原件版本、SHA256、解析器版本、全部段与位置；fragmentId 再绑定单段。相同重放稳定，不同原件版本隔离。原件和既有片段只追加，不能覆盖旧来源或用户编辑。
- `resolveAttachmentQuote(parsed, fragmentId, quote, start)` 只接受该片段指定 offset 的精确非空引用；不会用整文替代每条引用。返回既有 `SourceReference`，不生成身份、归属、评分或确认时间。
- DOCX/PDF 默认使用批准的实际 adapter；显式 `decoders:{}` 仍可表示该运行器未接入。自定义 `AttachmentDecoder` 只解码 bytes，输出严格 decoded/unsupported/failed 协议；没有 URL、人员、模型或确认信息。
- DOCX 通过 Mammoth 语义 AST 提取正文段落，保留空段与显式分页符所在段的序号。`docx:body:pN:u16:start-end` 相对于该段的原始语义文字；手动分页不等于稳定排版页，**不输出物理 page**。保留正文 tab、换行、超链接显示文字，拒绝正文表格、图像、脚注引用、未知内容及忽略告警。关闭外部文件与嵌入样式，生成 HTML 不输出、不渲染。解析正文成功不等于整个原件已完成分类，父不能仅据此设置837/873的 complete。
- PDF 从本地 bytes 逐物理页提取，`pdf:items:start-end` 引用该页实际 TextItem 索引范围，按库的 hasEOL 分片，只拼库返回文字。真实空白或只有矢量装饰的页可跳过，后续物理页码不压缩；有可用文字层的页允许 Logo、图标或装饰图，只有无可用正文且有图像绘制的页判扫描，混合扫描仍整体 unsupported，不把部分文字作为全份成功。已标记结构树中的 Table 明确拒绝；无标签、无边框文字表格无法保证可靠识别，**不声称通用 PDF 表格检测**。XLS/PPT/视频等其他文件格式一律 unsupported。
- 空白、损坏、完整性漂移、流错误与资源超限分别失败；库异常正文/objectKey 不进入提示或日志。worker 的 stdout/stderr 私下排空，仅严格结果协议回传。读取流须响应传入 `signal`，运行器应另给有界读取 deadline。

## 隔离与资源边界

`createDocumentDecoders(options?)` 默认每次创建独立可终止 worker；生产按主线既有 Node24 + tsx 源码 worker 运行，不依赖 Next 请求上下文。没有修改全局 worker 注册。发送独占、精确长度的字节副本，避免把 Buffer 池相邻内容一并传入。

- 默认/最大预算：60秒、V8旧代堆256MiB、栈4MiB、DOCX实际解压总量32MiB、PDF200页、正文总字符100万、单图200万像素。可传更小预算；maxBytes/maxFragments/maxFragmentChars仍由可信运行器明确指定。这些是解析能力边界，不改2GiB产品上传上限。V8限制不等于OS进程隔离，ArrayBuffer/native内存不由旧代堆上限保证。
- DOCX只做窄ZIP资源预检：中央/本地名字、方法、边界一致，拒绝重复或规范化路径冲突；用Node内置zlib maxOutputLength核实际解压总量、声明大小与CRC。仅允许标准stored/deflate；不支持ZIP64、加密、分卷或异常容器。不读取XML正文，不取代Mammoth。
- PDF关闭Wasm、系统字体、XFA、网络取字体和渲染，CMap/标准字体仅取已锁包内本地资源。6.4.299已无isEvalSupported API且无eval调用，未通过类型强转保留失效开关。document/page脚本动作与附件识别后拒绝，脚本从不执行；解析不是恶意文件扫描工具。
- 固定PDF.js 6.4.299存在公开getOperatorList先resolve空/部分ops、后reject内部流的顺序问题。唯一私有seam在首次读取前包装 `_transport.messageHandler.sendWithStream`，只对GetOperatorList单reader逐块透传；先记sticky读取失败，再交原pump。await公开API后先check失败，再判空白。未知版本/形状失败关闭；其他action/this/参数保留，未修改node_modules。升级须先跑真实超像素、缺尺寸图像与正常空白页反例；上游修复后才考虑移除seam。
- 显式stopAtErrors与warning级别；仅忽略固定 6.4.299 的已知 TrueType hint 字节码提示（如 TT: undefined function），不忽略真正字体/文字/图像解码错误。未知警告继续失败，专用 worker 不打印或回传警告原文，避免遗漏图像被当空白。结果、abort、deadline、error和无结果exit均终止线程并清理监听器。

## PDF 过滤与回归材料（10/31）

解析版本提升为 `pdfjs-dist@6.4.299:items-v2`，新解析仍追加事实，不改写旧片段。非水平基线和纵向文本不作为正文；斜体的字形剪切不会误当旋转。平台水印仅匹配独立整行的 `北森`、`Beisen`、`iTalent`、`北森iTalent`、`www.beisen.com`、`www.italent.cn`（空白和大小写归一）；正文中提到平台的句子保留。遇到被过滤的旋转项时先结束当前片段，再用原始 TextItem 索引开始下一段，不压缩索引，也不把跳过的文字夹在同一个引用范围里。

`tests/fixtures/attachments/filtered-text.pdf` 由同目录 `generate.py` 从零生成，含旋转装饰、水平平台水印和应保留的正文提及。`logo-demo-campus.pdf`、`logo-demo-hr.pdf`、`logo-demo-professional.pdf` 是 BOW-896 固定提交 `9533f64306ed68a6c2d2966474ef6d89033a5e31` 的 `tests/fixtures/bow-896/interview/{campus,hr,professional}.pdf` 字节副本，仅用于本卡独立回归；不修改该卡目录，也不导入其未提交内容。来源 [PR #251](https://github.com/bowenQT/QTalent/pull/251)。这些是从零重建的化名兼容样例，只证明带 Logo 的样例能提取文字及物理页，不证明官方模板 1:1 或真实材料全量兼容，不从文字标签推断单选分数。

三份 Logo 样例的重建由 BOW-896 生成器负责，本卡 `generate.py` 只重建自己的基础/过滤夹具；不要求 CI 安装额外 Python 依赖。合成诊断边界测试只替换 PDF.js 返回值/警告，实际三格式与混合扫描、坏图像、页数/字符预算及独立 worker 另由真实库回归验证。

## 873 冻结 port v1

已只读核对 PR186 **ebbd832c760d3db11efed8a654d4d07d4cfc6d10** 的 `uploads/README.md` 和 `handoff.ts`。复用其 getter，不直接读写上传表、不复建原件或上传会话：

```ts
const input = createValidatedAttachmentInput<Transaction>({
  readValidatedUpload: (reference) =>
    readValidatedUpload(uploadStore, reference),
  canProcess: async (tx, binding) => {
    // 父接既有当前记录 WRITE 策略；权威 quotaScope 必须与绑定一致。
    // 不用 readOriginal：未解析版本尚无 fragment/complete 分类。
    return currentRecordWritePolicy(tx, binding);
  },
  openObject: async (objectKey, signal) => {
    const object = await kodo.openObject({ objectKey, signal });
    return object.body;
  },
});
```

上例中的 `currentRecordWritePolicy` 是待父连接的真实策略，不是本卡新增的授权算法。`readValidatedUpload` 返回的 uploadId/version/jobId/purpose、account/quotaScope/target、对象字节数/MIME/SHA256 运行时严格校验；worker 只接受与当前 job.resourceId/inputVersion/jobId 一致的 attachment。open 前再次取 getter 检查绑定漂移，私有 objectKey 只在 server → Kodo 间使用，不进入 binding、job DTO 或整理请求。

## 任务事务与 845 交接

`runAttachmentParse(jobStore, ports, {jobId,attempt}, options)` 复用已合 #94 的 JobStore/advanceJob。队列 payload 不含 accountId、objectKey、人员或客户端内容。`registerAttachmentParseJob(boss, run)` 只导出独立 `attachment-parse` 队列注册，未写全局 worker。

1. claim 事务检查当前写权限、完整上传绑定、attempt 和可运行阶段，推进 revision。running/partial-parsing 的重新投递可接管旧 worker；其他阶段、失败、待人工与终态不重跑。
2. 只读解析在事务外，不锁着事务调用供应商或模型。读取失败保存安全失败快照；没有隐式无限业务重试。
3. 完成事务重新授权、核绑定、attempt/revision/cancel fence。`ports.saveParse(tx, binding, bundle)`、`ports.enqueueArrange(tx, request)`、`tx.save(job)` 必须使用同一个事务 context。saveParse 对同 ID 比较完整不可变 bundle，只有 `created` 首次结果排整理，`existing` 不重复入队；冲突和任一写入异常全部回滚。原件和旧任务历史不删除。
   已成功 claim 的当前 attempt/revision 在完成前失去写权限或发现权威绑定变化时，只保存 `failed / input_changed` 任务终态（阶段 failed、source null、fragmentIds 空），不保存解析片段或排整理；返回值仍保留 forbidden/ignored。初始 claim 前的拒绝仍不读字节、不修改任务。旧 revision/attempt 不得写入这一失败；已接受的取消优先确认 cancelled。公开读取和 retry 继续由当前 requester/action 权限与 inputVersion 栅栏判断。

4. 取消只确认 cancelled，不落片段或排整理。公共投影按 job.status 重建 `stage:'cancelled',source:null,fragmentIds:[]`，不透传 #94 保留的旧内部 result。
5. `enqueueArrange` 只传 `mediaId,parseVersionId,originalVersionId,accountId,target,sources:SourceReference[]`。每段有独立真实引用，没有 excerpt、推断 personId 或确认信息。父将该端口接845的可信来源加载/整理任务；845/837负责分类、当前权限过滤、选人、规则与待确认草稿，本卡不另建整理业务。

当前 `saveParse` 和 enqueue 是显式注入端口，**没有原生 PG 存储适配/应用注册**。父确定 parse 元数据的最窄持久所有权后，再由唯一责任方接现有 fragments 和任务/解析关系；需要新 schema 时单独协调，在已合 PR94 之后原生生成迁移。没有手写 SQL 或修改旧迁移。

## 公共任务策略与父接线

`createAttachmentParsePolicy(policyPorts)` 使用 `kind:'media'`，消费 PR112 的严格结果 schema。父应将其方法与859按可信 purpose 分派，最终只注册一份 media policy，不能并列注册两个同 kind。

- `policyPorts.can(tx, requesterAccountId, job, action)` 每次按当前请求者和具体 read/retry/resume/cancel 授权，核 attachment purpose/绑定；不能把上传者身份当查看者。未知或未分类范围拒绝。parse 不支持 resume；unsupported/无效内容等不显示可重试。
- 依所有者 #248/6558974554 裁决，failed 解析任务不接受新的 cancel：公共 jobs service 经此 policy 返回 `canCancel:false`，取消命令被拒且不写 cancelRequestedAt / 操作回执或入队；可恢复失败仍可按当前权限与 inputVersion 栅栏 retry。unsupported 等不可恢复失败不因此开放 retry。queued/running 的取消与已取消终态、既有已接受操作的重放语义不变。此处不修复或猜测历史异常数据，真实应用未接链路仍按下节说明。
- `visibleSources(tx, requesterAccountId, job)` 复用837/873已分类来源读取，仅返回当前可见的真实引用；必须是任务持久 fragmentIds 与 originalVersionId 的子集。公开 source 取可见列表首项，计数在过滤后计算，隐藏/未分类片段不泄露。
- `inputVersion` 重载当前输入；`enqueue` 在传入 tx 上用852唯一 producer 原子排 retry/cancel，不能另开连接或创建 singleton。
- 873 dispatch 在其归档事务内先建立 `newJob({kind:'media',resourceId:uploadId,inputVersion:originalVersionId,...})`，再通过同事务 pg-boss send 到 `attachment-parse`。该绑定应唯一；解析 worker 按873完成事实再次验证 completed.jobId。
- 应用入口、JobPolicy registry、worker、852 producer/env 及最终合并由父串行接线。本卡没有新增 HTTP/Action、读取凭据或真实 API 调用。

## 未完成门禁

- PR112 已于main32d0acb正式合入，最终检查不使用media overlay。此consumer只取已合target和media进度schema；request/grant/completed的recordCollectionId回显、source:null与raw-original读取身份union由相应上传/读取入口消费。worker输入仍按873冻结getter核upload/job/version绑定及当前写权限，不能用目标人员替代稳定记录集合或造片段。
- 873 getter/845/852应用接线、saveParse原生持久适配及本卡写入端口的真实PG原子验收仍Pending。完整工程真实PG统一覆盖若通过，也只证明实际执行的集成范围，不能把本卡端口fake说成真实持久链路通过。
- 精确命令、受检head与CI/远审终态记录于PR189；卡和issue保持In Progress/open。独立能力满足自测门禁后按授权转Ready，最终合并由父负责；代码回退保留原件、用户编辑与已有解析事实。
