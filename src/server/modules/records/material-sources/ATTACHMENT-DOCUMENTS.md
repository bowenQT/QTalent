# TXT / DOCX 原生附件落库（BOW-866）

`saveAttachmentDocument(tx, binding, parsed, { sourceCategory: 'original', demo })`
是 `runAttachmentParse` 的完成事务适配器。生产运行器必须先执行当前记录写权限、集合成员和原件绑定校验；此函数不授予权限，不创建队列或复建任务恢复。

- TXT 复用严格 UTF-8 parser `txt:v1`；DOCX 复用已锁 Mammoth 的独立可终止 worker `docx:mammoth@1.13.0:body-v1`。
- 受控读取仍经上传 handoff、对象流及 SHA-256 / 长度 / 预算检查。DOCX 不支持的正文内容、损坏文件、空白或坏编码分别按既有解析结果安全结束，不提交部分片段。
- 解析版本写入 `records_material_parses`，片段写入 `records_fragments`，`projectionVersion = document-paragraph-v1`。原件、parserVersion、parseVersionId、fragmentId、excerpt 及段落定位保持生产 parser 的事实；`pages: []`，不生成 PDF 页或虚构页码。
- TXT 的 `txt:pN:u16:start-end` 相对于去除一个起始 BOM 后的完整原文；DOCX 的 `docx:body:pN:u16:start-end` 相对于语义正文段落，空段与显式分页仍保留原始段号。范围是 UTF-16 半开区间，不是字符排名或 PDF 排版页。
- 只接受 `sourceCategory: original`；不会把普通附件当历史面评、已确认结论或已评分事实。解析成功只等于 `parsed`，不代表整理/人工确认完成。
- 上传与任务的绑定和 PDF 共用 `isUploadBoundToJob`（`upload-job.ts`）：已派发的上传须是自己的任务；暂存上传须是当前批次为它建立的解析任务。其余组合为 `material_conflict`。
- 同事务复核任务和归档绑定，复用 `writeMaterialParse` 的完整不可变结果比较及当前 fence。解析、首次下游排队、终态写回一并提交；重复消费已完成任务不重复落库，失败回滚保留原件。

## 验证与依赖

新增单测使用真实 TXT 与 DOCX parser，核原文/段落、格式和原件绑定、不造页与失败投影。`attachment-document-save.integration.test.ts` 使用真实隔离 PostgreSQL + 上传服务 + 解析运行器 + pg-boss，核同事务写入/回读/一次性排队、回滚及取消。该层上传授权是显式边界替身，不能代替生产权限验收。

`attachment-document-worker.integration.test.ts` 起与部署相同的 `node --import tsx src/worker/index.ts` 子进程；经测试 Kodo v2 上传与真实 PG 队列验证 TXT/DOCX 成功、重复消费、空白、损坏、表格拒绝和当前写权限拒绝；非法 UTF-8 在上传验证阶段已被拒绝，新增集成用例核无解析任务产生。测试 Kodo 仅替代供应商对象存储。上传侧沿 #373 的明确策略替身，处理侧用真实当前权限；它证明的是已绑定上传的消费者子链路，不证明生产 Kodo/部署环境。暂存 TXT/DOCX 经 MCP `record_moment` 进批次、由同一 worker 子进程解析并在批次中读到 parsed，以及暂存上传配错任务时保存被拒，见 `usecases/attachment-parse-worker.integration.test.ts`。

实际应用接线依赖 #373 的消费者：格式 gate 允许 TXT/DOCX、decoder 增加已有 DOCX decoder、saveParse 分派本适配器。共享路由由唯一集成方写入；整理 enqueue 由 c902 独立接入。没有新增 schema、迁移、依赖或锁文件变更。

本机云端受 socket 权限限制不能启动真实 PG；未将未运行的 PG 测试记为成功。完整 PG 与源码 worker 测试必须由现有 GitHub `foundation` 的隔离 PostgreSQL 作业实跑并通过，方可把此项交付声明为已验证。最终受检 SHA、命令和结果记录于 PR。
