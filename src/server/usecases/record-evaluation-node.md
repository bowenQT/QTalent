# 记录入口的评价节点推导（BOW-845）

依据 #248 所有者评论 6564917769，页面不增加节点选择器。生产调用：

```ts
await resolveRecordEvaluationNode(accountId, { personIds, projectId });
```

从 `record-evaluation-node.ts` 导入。`accountId` 必须来自服务端认证；请求人员和项目只是选择条件。结果为 `unique`（含 `evaluationNodeId`）、`multiple` 或 `none`。依赖失败抛出不含底层诊断的 `RecordNodeResolutionUnavailable`（message 为 `unavailable`），页面应提示暂不可用，不伪称无节点。

每次调用在只读、可重复读的真实数据库事务内，通过 `loadArrangeActor` 读取当前绑定、节点、主体、有效评价关系和项目权限。复用 `canWriteArrange` 判断所有选定人员在同一个节点可写；多个有效节点不任选，不返回隐藏候选明细。项目上下文不代替节点关系，未增加项目到节点的推测映射。

空人员、重复人员、未知字段和无效选择返回 `none`。空人员默认账号本人仅来自前端提议，所有者尚未确认；当前实现不启用这个默认值。对象的 `noReview` 约束保留，评价人的 `noReview` 不使其失去已授权履职资格。

这次推导不生成记录、任务或凭据，也不授权后续保存。结果在返回后可能过期；实际 producer 仍须按既有事务重新验证当前身份、关系、来源和节点。页面/actions 接线属于 BOW-847，由其作者消费此入口。

可注入真实 Database 和业务时钟的 `createRecordEvaluationNodeResolver` 用于应用组合和集成测试。PG 测试使用正式迁移、隔离测试库及化名节点/关系；不需要模型或供应商调用。
