# 文本附件解析核心（BOW-866，部分交付）

[SDD v0.2 与独立交叉评审](https://linear.app/bowenzhong/document/bow-866-文本附件解析-sdd-v02-3c8166c04ea0) · [Draft PR189](https://github.com/bowenQT/QTalent/pull/189)。

本目录提供 TXT 解码、可注入的 DOCX/PDF 端口、真实来源片段、873 输入适配与独立解析任务。**DOCX/PDF 库尚未批准/安装，真实格式验收和应用持久接线没有完成；不能把端口夹具当作三种格式已支持。** 没有默认生产服务、内存生产 store、模型调用、授权 allow-all、共享 worker/env 或迁移。

## 入口和定位

- `parseAttachment({version, content, limits, decoders?, signal?})` 接收已归档版本和只读字节流；`version` 包含 mediaId、originalVersionId、filename、mediaType、byteLength、sha256。流式检查实际长度、SHA256、资源预算；拥有每块字节，避免供应商复用缓冲区改变已验内容。超出解析能力是失败，不暗改 2 GiB 上传合同。
- TXT 严格 UTF-8，去一个起始 BOM，保留中文、CRLF、段内换行和原文。空行与 form-feed 分段，首尾空白不进入 excerpt。`paragraph: txt:pN:u16:start-end` 的范围相对于**去 BOM 后的完整原文**，UTF-16 起点含、终点不含；excerpt 就是这个范围的精确子串。没有物理页码，不补 `page:1`。
- parseVersionId 绑定原件版本、SHA256、解析器版本、全部段与位置；fragmentId 再绑定单段。相同重放稳定，不同原件版本隔离。原件和既有片段只追加，不能覆盖旧来源或用户编辑。
- `resolveAttachmentQuote(parsed, fragmentId, quote, start)` 只接受该片段指定 offset 的精确非空引用；不会用整文替代每条引用。返回既有 `SourceReference`，不生成身份、归属、评分或确认时间。
- DOCX/PDF `AttachmentDecoder` 只解码 bytes，输出 strict `{status:'decoded',segments:[{excerpt,location}]}` 或 `{status:'unsupported',reason:'format'|'scanned'}`。PDF 每段必须带真实物理页；DOCX 只在来源本身可靠时带页。适配器须拒绝扫描/混合扫描漏页、表格等本期不支持内容，不返回看似完整的部分文档。不接 URL、外部文件、HTML 渲染或 OCR。
- 未接 DOCX/PDF adapter 返回 `failed/dependency_unavailable`；其他格式明确 `unsupported/format`，扫描件 `unsupported/scanned`。空白、损坏、完整性漂移、流错误分别失败；异常正文/objectKey 不进入提示或日志。资源预算由可信运行器显式传入；生产读取/解码须响应 `signal`，运行器应提供有界 deadline，未来复杂解析在可终止的隔离线程执行。

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
4. 取消只确认 cancelled，不落片段或排整理。公共投影按 job.status 重建 `stage:'cancelled',source:null,fragmentIds:[]`，不透传 #94 保留的旧内部 result。
5. `enqueueArrange` 只传 `mediaId,parseVersionId,originalVersionId,accountId,target,sources:SourceReference[]`。每段有独立真实引用，没有 excerpt、推断 personId 或确认信息。父将该端口接845的可信来源加载/整理任务；845/837负责分类、当前权限过滤、选人、规则与待确认草稿，本卡不另建整理业务。

当前 `saveParse` 和 enqueue 是显式注入端口，**没有原生 PG 存储适配/应用注册**。父确定 parse 元数据的最窄持久所有权后，再由唯一责任方接现有 fragments 和任务/解析关系；需要新 schema 时单独协调，在已合 PR94 之后原生生成迁移。没有手写 SQL 或修改旧迁移。

## 公共任务策略与父接线

`createAttachmentParsePolicy(policyPorts)` 使用 `kind:'media'`，消费 PR112 的严格结果 schema。父应将其方法与859按可信 purpose 分派，最终只注册一份 media policy，不能并列注册两个同 kind。

- `policyPorts.can(tx, requesterAccountId, job, action)` 每次按当前请求者和具体 read/retry/resume/cancel 授权，核 attachment purpose/绑定；不能把上传者身份当查看者。未知或未分类范围拒绝。parse 不支持 resume；unsupported/无效内容等不显示可重试。
- `visibleSources(tx, requesterAccountId, job)` 复用837/873已分类来源读取，仅返回当前可见的真实引用；必须是任务持久 fragmentIds 与 originalVersionId 的子集。公开 source 取可见列表首项，计数在过滤后计算，隐藏/未分类片段不泄露。
- `inputVersion` 重载当前输入；`enqueue` 在传入 tx 上用852唯一 producer 原子排 retry/cancel，不能另开连接或创建 singleton。
- 873 dispatch 在其归档事务内先建立 `newJob({kind:'media',resourceId:uploadId,inputVersion:originalVersionId,...})`，再通过同事务 pg-boss send 到 `attachment-parse`。该绑定应唯一；解析 worker 按873完成事实再次验证 completed.jobId。
- 应用入口、JobPolicy registry、worker、852 producer/env 及最终合并由父串行接线。本卡没有新增 HTTP/Action、读取凭据或真实 API 调用。

## 未完成门禁

- DOCX/PDF 新类别批准：最小推荐 `mammoth`（DOCX，BSD-2-Clause）+ `pdfjs-dist`（文字 PDF，Apache-2.0）。批准后由共享依赖 owner 锁定版本，补实际中文/多页/空文件、安全预算和扫描/表格拒绝测试；不写复杂通用解析器绕过批准。
- PR112 当前仅固定 SHA `2397ad13d577e79bba4824fc691d62ec013ed5d2` 的 media.ts 临时组合；不是 main 已合。873 getter/845/852 真实接线和 PG 并发/回滚验收仍 Pending。端口 fake 验证的是本卡编排规则，不能冒称 PG 或完整业务链通过。
- 精确命令、受检 head 与当前 CI 终态持续记录于 PR189；卡和 issue 保持 In Progress/open，不提前 Ready 或关闭。代码回退保留原件和已有解析事实。
