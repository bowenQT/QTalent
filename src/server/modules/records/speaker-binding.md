# BOW-860：说话人人工绑定第一片

## 固定输入

基线 main `91b297afbc005a26a0f9bd93a2126fbd1d2fe6c9`。直接导入 897 `0b20a913621121848219e0966ba4bf4844d1bdb3` 的 speaker 命令、待核对项与回执，858 的展示项/恢复元组，899 `d5cf82fa264e022b8e4c928b008461e98c53293d` 的真实节点授权函数，以及 859 `f67329f984764055bb9874e15bb472db4481b28a` 的转写/绑定/处理上下文类型。不复制上游契约或实现。

本片只有领域规则、读取投影和显式事务端口用例，尚无生产数据库、HTTP/action、worker/producer 或完整原件授权适配。内存事务测试验证规则和端口协议，不能证明实际落库、排队或恢复完成。

## 人工决定与版本

- 完整 inventory 保留每个语段的稳定 fragment/reviewItem/providerSentence ID、原件与转写版本、原文和时间。空 providerSpeakerId 继续待核对；沿用 859 的 fragment ID 作展示 key，不能当员工 ID 或合并全部 null 语段。
- bind、标为无关、稍后、撤销均由人显式发起。同一转写中同一非空供应商 speaker 编号的命令覆盖该组，null 只处理当前语段。候选为当前集合成员、当前目录与实际 899 节点授权的交集，不使用旧候选提示、相似姓名或模型推断确认身份。
- 追加人工署名、墙钟时间、item revision 和 bindingRevision，不覆盖或删除已有决定。稍后不能代替已绑定/无关的显式撤销；同状态不重复署名或恢复。
- 条目/组状态改变推进 item revision；归属、无关、未解决之间变化推进 aggregate bindingRevision。事务同时 CAS 双 revision，并核集合成员版本。客户端不能注入署名、aggregate revision 或恢复任务。
- 归属变化须读取当前版本全部待确认草稿与已确认结果事实。仅失效真实待确认草稿，并核返回 ID；存在已确认结果则冲突，交 846 显式修订，不能静默改写。未知事实不能当空集合。

## 当前权限与恢复

完整原件涉及人员范围须已知，逐一核其节点和全部 requiredKinds 的 source-read 权限。片段完整不等于原件可见。写入另需 846 当前 actor/collection/membershipRevision 的处理写许可；读取许可、配额范围、worker canProcess 均不能替代。旧绑定人员已不可见时读取、新动作的整批结果与重放都关闭；经当前许可仍可显式撤销，回执不泄漏旧人员。

只有完整 inventory 中全部语段 bound/irrelevant、其他种类核对项清空、当前许可有效且未取消、worker 可处理，才形成恢复计划。860 不删除 905/906 等所有者的阻塞项。当前 859 只接音频 recording 时间引用，视频应用 lane 仍未接。

用例按 actor/operation 锁 → recording/collection/job 锁 → 当前事实与授权 → 幂等记录 → 双 revision CAS/追加 ledger → 草稿失效 → 可选恢复 → 审计/回执 → 再加载当前授权与版本执行。全部端口须共用同一原生事务，任一步失败整体回滚；禁止在事务回调外发队列。相同 actor/key/语义输入重放前仍核当前写权、候选和原件/转写/成员版本。

恢复端口同事务存真实 resumeGrant，重开原 processing checkpoint，并按 recording/original/transcript/bindingRevision 唯一业务键 enqueue RecordingWork。回执 jobId 为原 processing job ID，不是 pg-boss message ID。恢复元组为 `(recordingId, transcriptVersionId, bindingRevision, operationId)`；859 消费时重新核 grant、job/attempt、当前许可和完整绑定。收到 resume 消息本身不授予许可。

## 待整合

- 846：当前集合/成员、处理写权与成员版本；同锁下读/失效待确认草稿；已确认结果显式修订。
- 859：可信完整 inventory、当前 job/attempt/checkpoint、实际绑定 ledger 与 resumeGrant。replacePendingReview 只更新待核对投影，不删除人工决定。
- 837/873/908：完整原件当前范围与访问授权，不能从片段反推。
- X1/852：存储/原生事务适配、公共出口、唯一 producer/worker 和最终迁移。未接之前无 fake 默认成功。

## 验证

临时 detached 验证树固定 859 `f67329f`，其中 material-review.ts 与 sources.ts 的 blob 均等于 897 `0b20a913`；仅在验证树加入 899 `d5cf82fa` 的 evaluation-node.ts 原始 blob，再叠加本片文件。依赖代码未写入本任务分支。

本片命令：`pnpm exec vitest run src/server/modules/records/speaker-binding.test.ts src/server/usecases/speaker-binding.test.ts --maxWorkers=2`。覆盖率 include 只指定本片两个生产文件，沿仓库行/分支 85% 门槛。测试直接调用真实 859 speakerReview 核完整绑定兼容；另测 null 保留、权限、同组旧版本、幂等、已确认保护、恢复/审计/保存失败回滚。没有连接 PG、读凭证、启动服务或真实供应商调用。
