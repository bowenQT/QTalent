# BOW-910 原生领域处理

本目录是 MCP 的服务端领域组合，供应商协议仍在 integrations/mcp。当前续作消费 X1 在 #248 评论 6563027516 冻结的同事务入口；接口源码尚待组合时，不将此目录视为生产接通。

- `handlers.ts` 只调用真实 person 读取和 demand/record producer 的 `createInTransaction`，不接受自定义 allow/execute 回调，不自行写领域 SQL，不调用模型。actor 取903当前身份；客户端 personIds 仅是受权限检查的业务对象。
- 写后再用相同 operation 的原生重放核当前权限、真实根/输入和回执，校验输出来自同一请求。重放必须返回 replayed=true，不另建job；所有调用在903拥有的同一事务内，任何拒绝必须回滚全部写入和入队。
- person_brief 消费完整当前快照（包括所有其他创建者、superseded intake、撤回事件及共享出处）；先用唯一 talentSources 生成完整限制，再去掉 performance 与未分类普通原件，最后调用现有 quickViewFromData。不能只移除引用而保留事件、能力线或参考象限。
- 无完整 intake 清单则 unavailable。普通原件需服务端原生 intake 的已校验性质；不能用标题猜“北森”，不能把 Web 的 HR 权限当 MCP 外发许可。原型快照仍受既有 demo/历史性质/来源校验。

## 尚待真实组合与验证

固定基线是 X1 ca0ea875 的完整来源图，三同事务函数签名以 #248/6563027516 为准。旧 b122038 图缺 intake union 的4个负例当前明确为 Red，不复制该算法或改为通过断言；person/demand/record 的共享函数未到时有5条准确类型缺项。

下一步消费 X1 固定实现和受控结构，完成原生 PostgreSQL 事务/来源/撤权/幂等回归，再组合 HTTP、当前外部 token reader、同事务完整审计、每账号限流。审核 read-committed 的锁后事实和最后权限读取，不用内部独立事务或伪 Database 冒称可回滚。共享审计现只有 actor/action/resourceId，channel/revision 的正式记录方式由 X1 给出；本目录不静默丢字段或另造审计表。

真实部署后的 Cloudflare Access 双客户端验收仍归整卡，不能用回环 HTTP 和测试身份替代。未配置的渠道保持拒绝；不签发或创建生产 token。
