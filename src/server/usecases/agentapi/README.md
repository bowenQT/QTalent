# BOW-915 会话规则

`session-policy.ts` 是会话归属/权限快照与单轮事件回放的可执行规则。输入必须来自903实际identity.current、完整当前EvaluationAuthzContext，以及受限真实AgentAPI decode；不是客户端可提交的授权声明。

- 账号、person、凭据ID/代次和完整权限事实digest绑定；当前有效区间单独入摘要，有效期边界即使没有数据库写入也使旧会话失效。事实排列变化不误判。该保守摘要可能因无关权限事实变化让用户重开会话，但不放宽授权。
- 此摘要不涵盖业务材料撤回/来源变化，**不能替代每次用户输入、工具结果发送和模型回答输出前重新验证历史工具证据**。实际持久组合必须先拒绝旧上下文，再归档provider session；不让模型在原session中“忘掉”被撤权的材料。
- 回放按已受理user event开始；旧idle、重复事件、接收ACK都不代表完成。相同ID变内容、另一个用户输入、陌生/非custom工具均拒绝。
- 仅903已冻结AgentAPI工具；未有成功DTO的第三幕两个读取保持unavailable，评分/需求确认、归因、发布均不可用。
- requires_action只给出已存在且输入合法的待执行调用，已完成ID不重复执行；end_turn之前尚有未完成工具则失败。实际执行和结果发送进度必须由真实事务账本记录，不能把调用方传来的Set当生产幂等。
- user.interrupt不能因Native的end_turn变成功；模型错误、预算耗尽、终止分别失败。最终文本明确标ai_suggestion，不能作为人工结论。

固定输入：main fe34b6f后普通消费80237f8，含903 b43b26a与真实同tx入口。没有修改910或共享认证。下一生产阶段需要X1冻结会话/turn/tool账本和正式迁移、完整公开第三幕成功DTO及各读取同tx入口；请求#248/6563655365。协议、规则与下述事务编排使用离线测试；尚无915原生PG/生产工厂或三幕付费验收。

## 已绑定会话的事务编排

`service.ts` 提供 submit / advance / cancel，输入是903签发的不透明身份与服务端会话ID。`ConversationPorts<C>` 是当前独立切片的明确接线要求；测试用可串行、可回滚替身，**不代表原生数据库已实现**。没有内存生产实现或自动兜底工厂。

- transaction 按会话串行；同事务读取所有旧turn/tool回执、当前903身份和899授权事实，执行领域业务、entry审计与工具回执写入。禁止把自行拥有事务的业务 service 套进这个回调。
- 先提交 user POST 的 reserved 意图，再在事务外发送。相同 operationId 同内容重放，异内容冲突；一个会话最多一个未完成turn。reserved / sending / outcome_unknown 不自动重投；已知拒绝单列 failed，不把未知提交说成未发生。GET失败允许下一次显式查询；模型错误不当资料不足。
- 工具只消费 `submit_material_batch` / `person_brief` / `draft_requirement` 三种严格成功DTO。服务端以会话ID与provider event ID生成业务operationId，覆盖模型提供的写入幂等键；原输入保留作事件一致性核对。业务执行、授权输出、审计和sending回执必须同事务提交。发送工具结果失败不回滚已经提交的业务动作。
- 第三幕两个工具以及本切片尚未接入的read工具明确 unavailable；未知JSON、确认、归因、发布不作为成功返回。DTO还须与已核输入身份匹配。单次工具披露限制64KiB；会话最多32轮、每轮最多120次显式poll，配合已有每轮8工具/有界协议限制成本。这是服务端资源上限，不是产品统计。
- 每次输入、工具执行/发送、回答输出、已完成结果重放均重验历史工具来源。账号不同不得读取或销毁别人的会话；同账号的person、凭据代次、授权事实或旧来源变更使会话永久invalidated，恢复旧权限也不能继续喂旧provider上下文。异步调用后再验。外部调用与数据库提交无法构成跨系统原子事务；撤权后不再发新请求或披露结果，已在途请求不能宣称已撤回。
- cancel 先停止本地会话，再事务外archive并核状态；cleanup=unknown/reserved不盲重发，不冒称provider已停止，也不撤销已经完成的领域动作。invalidated会话的后台归档仍需X1绑定可信服务端清理流程，不能绕过用户认证来输出旧材料。

## X1 最小原生结构请求

下列是待X1实施的三表建议，非已生成schema/SQL。字段投影以 `ConversationRow` / `TurnRow` / `ToolRow` 为准，所有表补 createdAt / updatedAt；不镜像人员目录、材料/需求内容表，不建通用工作流或供应商平台。

| 表                     | 必需字段与约束                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| agentapi_conversations | id PK（服务端生成）；bindingId 可空FK → entry_agent_api_bindings.id，删除置空，不能阻挡真实登出删除；不可变的签发authority快照 accountId/personId/credentialId/credentialRevision>0/authorizationDigest；providerSessionId可空且非空唯一；state creating/active/invalidated/outcome_unknown/failed/cancelled；cleanup none/reserved/verified/unknown。快照不是当前权限，binding失效/缺失必须拒绝。创建阶段先reserved式creating、事务外一次POST、回填provider ID与active；未知创建不重发。本核心仅接已经真实绑定的非空provider会话。固定agent/version/model/工具配置与提示词版本由受控创建配置引用，不从请求自由指定。 |
| agentapi_turns         | PK(conversationId FK, operationId)，按会话递增ordinal唯一；inputDigest为规范user事件SHA-256；state reserved/submitted/complete/outcome_unknown/failed；userEventId可空，非空在会话内唯一；answer可空、最大65536字符，只有complete可有，性质固定ai_suggestion；polls 0..120；部分唯一索引确保每会话仅一非complete turn。无需持久化用户原文，不能把摘要当已发证据。                                                                                                                                                                                                                                                     |
| agentapi_tool_events   | PK(conversationId,eventId)；复合FK(conversationId,operationId)→turn；businessOperationId唯一且不可变；name仅上述三工具；args为对应冻结输入且不可变；successPayload为对应严格成功DTO，限定64KiB，不是任意JSON成功；state sending/sent/outcome_unknown；resultEventId可空，非空会话内唯一。业务写入+审计+本行同tx；相同event异name/args/turn冲突，不用DO NOTHING隐藏差异。                                                                                                                                                                                                                                              |

真实store的 `transaction(id, callback)` 必须先按conversation行锁串行，再完整加载turn/tool；`save` 在该tx执行并校验上述唯一/状态/不可变事实，不能依赖进程内mutex。首次创建尚无行时可用现有事务级advisory锁，不新增扩展。缺binding/provider会话、非法历史DTO等直接unavailable，不能补默认身份或空历史。删除binding后仍保留安全的未知发送/审计状态，但不允许用户重放。

### 必须提供的当前事实与领域同事务接口

1. `current(tx, identity)`：903当前凭据/账号人员绑定 + `loadEntryAuthorizationContext(tx, accountId, now)`，构成现有 `sessionAuthority`。真实auth_session登出/过期、binding revision/revoke、所有899有效期事实均需检查；不能只读签发快照。
2. `execute(tx, identity, name, args, operationId)`：消费已有846 record create、852 demand create、person brief同tx算法，按903入口前后权限、输出来源过滤并写entry审计；统一映射成三种冻结DTO。现910包装有自行拥有的外层事务，不能直接作为本端口实现。
3. `revalidate(tx, identity, tool)`：每条历史回执都重新读取完整当前事实，并比较已披露版本/来源/内容仍可见。材料receipt读需真实readBatchInTransaction；需求job/result读需真实readInTransaction/当前job版本；person需当前完整来源图和投影。仅权限digest相同不代表材料未撤回；仅找到batch/demand ID不够。任何缺reader返回不可用，不默认true。新工具结果同样先验再发。
4. `create/read`会话工厂与唯一HTTP组合由X1提供共享入口；创建使用已实现的Native client.create和903可信owner，不制造token。全部供应商I/O在事务外。未发布reader/schema前本PR仍不能称生产可运行或转Ready。

本轮边界：只增 service.ts/service.test.ts 并更新本说明；未改共享schema、SQL、公共出口、认证、MCP handler或路由。正式DDL/main依赖、真实PG并发/回滚、完整当前head CI、最终三幕工具/部署验收分别保留，不把替身通过替代其中任何一项。

## 原生 store 增量（X1 bf058f9c 后）

`postgres.ts` 的 `createAgentConversationStore(db)` 已真实落地三表读取/保存。`transaction` 拥有RC事务，`inTransaction` 复用调用方外层事务，不套假Database或嵌套拥有事务的业务service。先锁conversation，再读完整turn/tool；`save` 只接受该事务内被锁的同一会话，校验签发身份/provider不变、turn顺序和输入digest不变、历史工具args/成功DTO/归属/服务器业务键不变、状态不倒退、不能删除历史。每次读取再次严格解析DTO；精确wire大小使用紧凑 `{status,payload}`，不以JSONB展示字节数代替。

`createAgentConversationPostgresPorts` 是私有具体组合，复用903真实不透明身份服务，在锁等待后调用current，再在本事务读899上下文；没有凭据发行或管理员兜底。当前仅 `person_brief` 消费现910领域handler，实际读取完整person来源、重新构造投影、同事务写entry审计及tool回执。材料/需求两个工具在写入前返回unavailable，历史回执也不会默认验证通过：现 createInTransaction 的幂等重放在业务操作不存在时可能创建，不能拿它当只读历史验证。待X1给真实readBatchInTransaction与demand/job历史reader后再接这两项。

进一步的共享身份接口请求：903当前authenticator参数仍是Database，身份issuer的current读取使用其既有连接；本增量没有声称凭据查询已加入同一个Transaction，也不复制其签名/owner/expiry算法。X1应将其真实只读reader提取为DbExecutor或等价最小入口，保持已签发opaque identity的同owner约束，供915锁后同tx重验。现PG已验证真实行锁等待后发生credential revision/授权撤销时零provider发送，以及真实session删除、换绑拒绝。

本轮验收：新增21条原生PG + X1三表19PG + 903既有15PG + 本卡89unit = 144/144；统一五生产文件行96.91%、分支90.12%。manifest与schema blob已核匹配X1 bf058f9c，测试只加载test-db.env并显式使用其受控临时迁移；未改任何SQL/meta、未读取供应商凭据或发真实请求。测试provider为明确离线替身，存储/身份/权限/person投影/审计为真实代码与真实PG。缺失/creating会话拒绝，不把测试插入的绑定行说成已实现provider会话工厂。

仍未完成：真实provider创建意图/ACK收敛工厂、上述只读领域/身份入口、剩余工具、唯一HTTP/生命周期注册、正式迁移和默认CI，以及批准环境的三幕多轮验收。该清单替代旧的笼统“缺三表/缺store”，本卡继续等待精确共享接口后推进Ready。
