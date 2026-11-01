# 企业微信持久接线（BOW-909）

本目录把已验证企业微信消息接到 Web 共用的 845 文本 producer。`postgres.ts` 使用真实 PostgreSQL 消息 / 回执账本和 903 身份 reader；`native.ts` 把它装配进实际 `createWecomClient`。创建工厂不连接网络、不读取环境变量，显式 `connect()` 才订阅；常驻进程注册仍由 X1 承接。

## 输入与事务

- `message.ts` 冻结 scope / bot / sender / message 四元键，临时 ACK 编号变化不新增业务。文本原文逐字保留，幂等和冲突由持久事实判断；内存 WeakMap 只保管当前连接的消息证明，不负责持久去重。
- `native.ts` 仅接受实际订阅成功后的服务端消息闭包。复制对象、HTTP sender 和裸账号不是凭据。发送前再查当前连接、真实 903 外部绑定和完整领域权限。
- `receiver.ts::prepareWecomTextBatch` 只准备单文本。`resolveTarget` 必须由服务端提供已核实节点、全部主体及 project（真实无项目时显式 null）；缺失即 unavailable，不从 sender 或正文猜。当前工厂没有默认演示目标，也尚未装配生产目标来源。
- `postgres.ts::receive` 在四元 advisory lock 后重读绑定，锁住凭证和账号绑定，使用当前 899 全主体权限与 `createRecordBatchArrangeRequests.createInTransaction`。消息账本、原件 / 批次、审计及 pg-boss 入队同事务提交。预算异常和任何失败必须逃出整个事务后再映射，不能提交半份来源。
- 重放先核当前身份与领域权限，再核原文摘要 / 节点 / 主体 / project；凭证修订、账号重绑、撤权或关系恰到期均不凭旧消息放行。真实 845 job/input/batch 是唯一状态来源，没有第二套模型调用或任务账本。
- 媒体、多部件消息目前明确 unavailable，不丢附件伪装文本；待 873 归档及真实 source producer。媒体临时 URL / key 不存作原件，外部归档与 SQL 不声称跨系统原子提交。

## 持久回执

- 回执由当前真实批次读取，只投影 batchId、业务 revision、四种既有安全状态；群里仅「收到了」。不发送姓名、原文、草稿、隐藏标记或隐藏数量。
- 私聊唯一键含消息 / 批次 / revision / status；相同修订的不同状态仍是不同回执。业务 revision 与 credentialRevision 分开。
- 先提交 reserved，再重查当前授权与状态，最后穿过实际发送队列。确定 ACK 后标 acknowledged；超时、ACK 后写库失败等记 outcome_unknown。既有 reserved 也可能已经发出，重启和重放都不自动重发；不承诺供应商恰好一次投递。
- `native.ts` 在实际排队发送点调用 `canSend`，因此群 ACK 等待期间撤权也不会继续私聊。发送失败按安全错误上报；不会把不确定投递当成功。
- 当前 `deliver` 可读取模型完成后的新状态，真实 runner 测试已覆盖；但 native 工厂目前只在收消息 / 重放时驱动。**任务完成后的自动通知，以及无消息重投情况下进程重启后的主动恢复，尚未接入常驻调度。** 原协议 client 的原消息证明不能拿伪造消息补齐，须明确服务端主动发送入口与当前授权重验后继续接线。

## 固定组合与验证

原协议输入 `c38895fc1c7adbc6e120e47431f98bb0a58f7cb8` 的九个文件保持不变。文本片 `431799e1bed8c8b3d48945378017e5e238f29ecb` 普通合入 X1 `2c73780aa43fe4f5e71c4dab548e45c921433247`，基线 `575cb6b3a34713bd3213e52be419a6b400a01e3b`；包括同事务入口 `3fef8c3288e700bf71b2e9fcd91f81e22485dff8`、真实外部绑定 reader、审计与两账本。尚未合入的依赖不能称作 main。

统一定向运行使用 Node 24、`vitest.integration.config.ts`、`--maxWorkers=2`，同时纳入本目录及 integrations/wecom。147 / 147 通过：118 单元、6 真实 producer PG、23 真实 receiver PG / 本地 WebSocket 组合。范围覆盖率：行 97.11%、分支 90%；本目录行 96.71%、分支 85.47%。覆盖率是自动测试统计，不是人才指标。

验证包含：新连接 / 重启重放、四元隔离、并发单写 / 单发、原生队列失败整组回滚、锁等待后撤权、目录重绑 / 精确到期、真实 runner 只调用一次合成外部模型、reserved / ACK / unknown 持久终态、未知目标与范围外共同主体零写入、本地真实 WS 订阅 / 超时 / 关闭。模型只替换外部边界；账号、授权、producer、SQL、队列均调用实际实现。本地 WS 使用化名合成帧，**不是真实企业微信或供应商验收**。针对 ACK 未确认与等待期间撤权的两项回归先失败，修复 native 错误传播后通过，未修改权限策略或回执状态算法。

本轮 PG 使用 X1 固定原生临时迁移，由显式 `BOW_909_TEST_MIGRATIONS_DIR` 指定；使用前核验 manifest 与结构一致，正式 0000–0009 未改。测试默认仍读取正式 migrations，没有 override 时缺新结构，不能把本轮组合测试记作默认 CI 通过。历史 `431799e` 的完整 CI 通过只适用于该历史头。

复验命令（迁移目录由 X1 受控交接，不把路径作为默认配置）：

```sh
pnpm exec vitest run --config vitest.integration.config.ts \
  src/server/integrations/wecom src/server/usecases/wecom --maxWorkers=2 \
  --coverage \
  '--coverage.include=src/server/integrations/wecom/{protocol,client,media,receipts}.ts' \
  '--coverage.include=src/server/usecases/wecom/{message,receiver,postgres,native}.ts'
```

测试库只通过指定 test-db.env 加载，重检查需领共享槽；测试启动的数据库、队列、WS、client 均清理。没有读取机器人凭据或真实连接。

## 继续到 Ready 的缺口

1. X1：正式迁移及最新 main / 依赖组合，之后执行当前头完整默认检查。当前作者未改 schema、SQL/meta、公共出口或 worker。
2. 909 与 X1：已核实目标 reader、唯一常驻 client 注册 / 关闭、实际任务状态通知。909 私有实现继续负责，worker 公共注册由 X1；不能把传入测试目标当生产目标装配。
3. 873 / source producer → 909：媒体一次归档、稳定引用 / 重启恢复，当前单文本片不替代这项验收。
4. 完整实现就绪后，持 resource-wecom-test 才加载专用凭据，按明确计划验证真实收发 / 深链。当前无此实测。

原 Claude 通过只覆盖旧协议头；新增实现更新同一审查请求、精确目标头，原修改轮次保留。整卡及 PR 保持未完成，不能以局部 PG 或历史 CI 转 Ready / 关闭。
