# 记录撤回与待办取消

本端口是 BOW-846 原生撤回事务的一部分，供 `record-save.ts` 使用，不是客户端动作或任意取消待办的入口。跨域编排留在 `server/usecases`，records 与 programs 不新增反向依赖。

```ts
const committedUndo = await commitRecordUndo(/* 原有参数 */);
await cancelWithdrawnRecordConfirmationWork(
  tx,
  committedUndo,
  workItems,
  clock,
);
// 原 record.undo 审计和外层事务提交
```

- `workItems` 必须是原事务按 batch/draft、确认资源、节点及主体锁定的原始事项快照，不重新从请求构造或用新分派覆盖。原有本人 completed 撤销处理仍先执行。
- 证明只在 records 成功写入实际 save/event 撤回、draft revision 和 undo operation 后签发，绑定同一 Transaction；复制、序列化或跨事务使用均不成立。
- 专用端口重新验证真实 account/actor、save/operation、batch/draft/node/subjects、已撤回事件和当前草稿版本，锁定事项后核对原 revision/分派，以 CAS 仅取消本次真正撤回事件对应的 pending 确认事项。其他资源、类别、节点或主体，以及 completed 事项均不会被批量覆盖。
- 等锁后重新读取业务权限与墙钟，五秒时窗不延长；取消审计、资源撤回和原事务一起回滚。第二评价人仅撤回评分、未撤回事件时没有资源取消副作用。

撤销回执的 `inputRestoration` 与 `originalInput` 严格配对：`available` + 真实原输入，或 `unavailable` + `null`。恢复输入需要当前完整输入的授权事实；创建者、全部 AI draft 或历史成功回执均不构成这份证明。合法撤销不能因此失败，`null` 也不是空原话。

records 的历史操作读取器验证旧/新载荷后，将保留回执中的全文归为 `unavailable/null`；原始输入仍按既有私有 save/batch 事实保留，供用例在有完整当前授权证明时重新投影，不改历史保存的 JSON 或 SQL。对外 API 不接受缺少判别字段的旧形状。作者接回后仍须完成私有层每次响应/重放投影及整批 R2 验证。
