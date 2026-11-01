# 企业微信持久接线（BOW-909）

`message.ts` 是消息/回执账本使用的纯规则，不是持久化或授权实现。唯一可信输入必须来自既有 `createWecomClient` 订阅成功后的服务端闭包；HTTP 请求提供的 sender、复制对象或裸账号不能作为认证。

- 消息稳定键包含 scope、bot、sender、message ID，跨 ACK 请求编号保持。输入指纹保留原始文本和有序部件类型；不把临时 URL/解密 key 保存为永久事实，也不声称仅凭部件类型证明媒体内容相同。归档后须另核实际明文字节摘要。
- 私聊回执仅允许真实批次 ID、批次修订和四个既有安全状态，不接收姓名、正文或隐藏数量。845 的批次修订跟随草稿内容，不是每次任务状态；同修订 processing 和 awaiting_confirmation 需要各自稳定键。相同状态/修订只能预留一次。
- 回执发送前必须持久提交 reserved。已有 reserved 可能在进程崩溃前已发出，和 outcome_unknown 一样不得自动重发；收到确定 ACK 才标 acknowledged。规则不能保证供应商恰好一次投递，也不以本机内存集合冒跨进程幂等。
- 消息重放仍先查903当前绑定和当前领域权限，不能凭旧账号/署名返回历史批次；909不自行调用模型，统一使用845真实producer及其操作键。媒体外部写入与SQL不是一个事务，必须依873稳定操作号恢复，不能伪称跨系统原子提交。

目前14项只验证上述纯规则，尚未实现/验证消息和回执PostgreSQL表、真实903外部映射、媒体归档或唯一批次接线。原协议组件96项和历史Claude通过保留各自范围，不作为新增持久化证据。

共享协调：#248/6562911150（原909+903+main普通组合）；6562927052、6562950919（最小表/状态与真实接口字段）。X1冻结结构与正式迁移，作者只写本目录服务/测试。903外部映射reader仍待；原Web/身份服务不能靠默认演示账号替代。845当前createFromSources未接，文件不得伪装text。无可信节点、完整主体、project或collection来源则unavailable，不解析聊天文字猜身份或把sender当材料全部主体。

本阶段不加载企业微信凭证、不连接机器人、不访问供应商。测试数据库仅test-db.env；需要真实连接时还须先取得resource-wecom-test。整卡仍要实际持久幂等、归档/整理、真实收发闭环、当前默认检查及跨工具审查，不能凭本规则文件转Ready或关闭。

## 真实文本 producer 组合（11/1 续作）

X1 普通同步 `086e257d9f297e076236703d92f69dd3a36c521c` 保全原九协议文件、消息规则与 903 `49132204` / main `fe34b6f`；普通合入同事务入口 `3fef8c3288e700bf71b2e9fcd91f81e22485dff8` 后，组合基线为 `4bec4fa2b6e93a63eeb42cfd6b3426ef72912492`。后者含尚未合入的 #316 / #322，不能把完整输入称作 main。

`receiver.ts::prepareWecomTextBatch` 是单文本的输入准备，不是已接通的认证 receiver：

- 真实协议解析后的原文逐字保留，操作号来自 scope / bot / sender / message 四元键，ACK 编号变化不产生新批次。
- 当前节点、完整人员集合和 project（包括真实无项目的 null）只能从服务端可信事实显式提供；不从 sender 或聊天正文猜。缺少目标或任一字段就 unavailable；人未核清不外发。
- 媒体及多部件消息不拆掉附件伪装为文本，不以临时链接 / key 当原件；待 873 真实归档和 source producer。
- 真正 receiver 必须在同一事务中读取当前外部绑定、完整领域授权、消息账本及实际文本 producer。准备结果不是权限凭据，也不能代替消息 inputDigest / 归档摘要冲突检查。

实际组合测试 `receiver.integration.test.ts` 使用仓库化名目录、899 节点关系、922 规则、原生 `createRecordArrangeApplication` 与 `createInTransaction`、正式迁移和真实 pg-boss 队列。6 项证明：新连接与不同 ACK 重放不增来源 / job；并发重复只有一份；同消息改正文冲突、不同 sender 操作隔离；外层失败整组来源 / 审计 / queue 回滚；当前关系恰到期后重放拒绝；缺目标 / 媒体不写入。测试没有注册模型消费者，模型调用为零。外部账号绑定与目标取自显式合成测试事实，**没有验证生产企业微信映射、消息 / 回执账本或真实机器人**。

首轮 5/6，一条测试误把 `originalInput.text` 当原件；最终 897 的公开 RecordInput 规范化该字段。依据实际 producer 修正取证对象后 6/6：分别断言规范化 DTO、原件 fragment 的精确原文、对应 originalVersionId 与 SHA-256 摘要，不修改上游实现来满足错误预期。单测包含文本保真 / 显式目标 / 媒体拒绝 8 项；本次先缺实现 Red，后 Green，未作为跨工具修改轮计数。

同事务预算错误必须由外层事务完整回滚后映射；`ArrangeModelInputBudgetExceeded` 不能在事务内 catch 后提交先前写入。正式 receiver 和两账本尚未实现，不能用这 6 项 producer PG 声称整卡完成。后续私有 `postgres` / receiver 消费 X1 冻结表，真实身份 reader 由 903 承接；schema / 出口 / 运行注册仍由 X1 唯一修改。此前14项纯规则的边界保留，生产余项仍按上文清单推进。
