# BOW-860：说话人人工绑定第一片

## 固定输入

本轮在原 PR #279 分支普通合入 main `27d7da28b887d3e0b8043a7ee3cdd915e67c2d56`，没有 rebase 或强推。897 的材料回执和 899 的节点授权已在 main：直接消费当前 `contracts/material-review.ts`（最近改动 `42056e02226f4c53a0b595d549dd329c158b70c4`）、`authz/evaluation-node.ts`（最近改动 `de21f0057fbea79d6e06cf30b9d55a27c2dfdd96`），以及已合 858 展示项/恢复元组，不复制契约或授权实现。

859 尚未合入。本片仍导入其实际转写/绑定/处理上下文类型；独立验证输入固定为 #276 已提交的 `905a2ea911ccfcd5fe640a5e0b783a10c50226c0`，包含同一 attempt 的租约接管语义。生产真实组合仍待 859/846 和 X1 整合，不把验证树的输入复制进本任务分支。

本片只有领域规则、读取投影和显式事务端口用例，尚无生产数据库、HTTP/action、worker/producer 或完整原件授权适配。内存事务测试验证规则和端口协议，不能证明实际落库、排队或恢复完成。

## 人工决定与版本

- 完整 inventory 保留每个语段的稳定 fragment/reviewItem/providerSentence ID、原件与转写版本、原文和时间。空 providerSpeakerId 继续待核对；沿用 859 的 fragment ID 作展示 key，不能当员工 ID 或合并全部 null 语段。
- bind、标为无关、稍后、撤销均由人显式发起。同一转写中同一非空供应商 speaker 编号的命令覆盖该组，null 只处理当前语段。候选为当前集合成员、当前目录与实际 899 节点授权的交集，不使用旧候选提示、相似姓名或模型推断确认身份。
- 追加人工署名、墙钟时间、item revision 和 bindingRevision，不覆盖或删除已有决定。稍后不能代替已绑定/无关的显式撤销；同状态不重复署名或恢复。
- 条目/组状态改变推进 item revision；归属、无关、未解决之间变化推进 aggregate bindingRevision。事务同时 CAS 双 revision，并核集合成员版本。客户端不能注入署名、aggregate revision 或恢复任务。
- 归属变化须读取当前版本全部待确认草稿与已确认结果事实。仅失效真实待确认草稿，并核返回 ID；存在已确认结果则冲突，交 846 显式修订，不能静默改写。未知事实不能当空集合。

## 当前权限与恢复

完整原件涉及人员范围须已知，逐一核其节点和全部 requiredKinds 的 source-read 权限。片段完整不等于原件可见。写入另需 846 当前 actor/collection/membershipRevision 的处理写许可；读取许可、配额范围、worker canProcess 均不能替代。旧绑定人员已不可见时读取、新动作的整批结果与重放都关闭；经当前许可仍可显式撤销，回执不泄漏旧人员。

只有完整 inventory 中全部语段 bound/irrelevant、本材料或受影响目标没有阻塞项、当前许可有效且未取消、worker 可处理，才形成恢复计划。当前真实 `materialId`、接受的 `resolution`、全部可披露的 `remainingReviewItemIds` 与目标范围内的 `blockingReviewItemIds` 按最终 897 回执返回，并验证整个冻结 schema 的 refine。

`SpeakerBindingSnapshot.otherReviewItemIds` 是服务端当前可披露的其他种类剩余项；新增必填的 `otherBlockingReviewItemIds` 则只含其中会阻塞本材料/受影响目标的项。两者必须由同锁下的真实待核对范围解析产生，后者须为前者的唯一子集。`null` 或缺失代表未知，动作返回业务冲突，不能用 `?? []` 放行；不按 ID 名称、客户端提交或材料批次总数猜阻塞归属。无关剩余项保留在回执，但不扣住本材料。异步提交后会再次核对这两个集合，变化时整体回滚。860 不删除 905/906 等所有者的条目。

当前 859 只接音频 recording 时间引用，视频应用 lane 仍未接。

用例按 actor/operation 锁 → recording/collection/job 锁 → 当前事实与授权 → 幂等记录 → 双 revision CAS/追加 ledger → 草稿失效 → 可选恢复 → 审计/回执 → 再加载当前授权与版本执行。全部端口须共用同一原生事务，任一步失败整体回滚；禁止在事务回调外发队列。相同 actor/key/语义输入重放前仍核当前写权、候选和原件/转写/成员版本。

恢复端口同事务存真实 resumeGrant，重开原 processing checkpoint，并按 recording/original/transcript/bindingRevision 唯一业务键 enqueue RecordingWork。回执 jobId 为原 processing job ID，不是 pg-boss message ID。恢复元组为 `(recordingId, transcriptVersionId, bindingRevision, operationId)`；859 消费时重新核 grant、job/attempt、当前许可和完整绑定。收到 resume 消息本身不授予许可。

## 待整合

- 846：当前集合/成员、处理写权与成员版本；同锁下读/失效待确认草稿；已确认结果显式修订。
- 859：可信完整 inventory、当前 job/attempt/checkpoint、实际绑定 ledger 与 resumeGrant。首次转写须由真实适配器把所有未知片段（包括 null）保留为 pending；供应商编号或候选不构成人工绑定凭证。当前纯组件无法证明适配器没有伪造 bound，须在原生 ledger 接入时验收。replacePendingReview 只更新待核对投影，不删除人工决定。
- 待核对范围适配：同锁下填充 `otherReviewItemIds` 与 `otherBlockingReviewItemIds`，并重核材料/受影响目标及当前披露范围；无生产默认空数组。
- 837/873/908：完整原件当前范围与访问授权，不能从片段反推。
- X1/852：存储/原生事务适配、公共出口、唯一 producer/worker 和最终迁移。未接之前无 fake 默认成功。

## 验证

独立 detached 验证树以本任务普通合入 main 的提交为底，仅加入 859 固定 SHA 的六份原始文件：`recordings/{types,policy}.ts`、`uploads/{handoff,types,service,content}.ts`。后四份是前者类型的传递依赖，不是新产品改动；这些文件均按原 blob 核对。然后逐字同步本片五文件，897/899 与其余 main 文件保持不变。

- Red：未改产品代码时，当前 main 契约 + 固定 859 输入的原 48 项实际 25 失败，三字段缺失与审查 6553599510 一致。新增回归先跑 Red 后修复。
- 本轮覆盖回执材料/动作、目标阻塞子集、无关项不阻塞、未知/缺失事实冲突、恢复后的范围变化回滚，以及审查指出的 requiredKinds 无权、错误 jobId、草稿已清空但失效 ID 错误等负例。
- 实际运行已安装的锁定 Vitest：`node node_modules/vitest/vitest.mjs run src/server/modules/records/speaker-binding.test.ts src/server/usecases/speaker-binding.test.ts --maxWorkers=2`；覆盖率再加 `--coverage --coverage.include=src/server/modules/records/speaker-binding.ts --coverage.include=src/server/usecases/speaker-binding.ts`，沿仓库行/分支 85% 门槛。
- 依赖安装先因未批准的构建脚本返回失败，未运行 approve-builds 或改配置；验证树用 `pnpm install --frozen-lockfile --ignore-scripts` 安装锁定依赖。测试没有批准或运行这些构建脚本。
- 原任务分支仍缺未合入 859 的 `recordings/types`、`recordings/policy`，类型/单测无法完整运行；组合验证不等于默认 CI。PR 保持 Draft + blocked，等待实际依赖与跨工具新 head 复核。
- 本轮不连接 PG、不加载凭证、不启动服务、不调用供应商，不验证原生事务、真实持久化、唯一 producer 或完整恢复。具体受检提交、实测数量和检查结果写在 PR 对应 head 的证据中。
