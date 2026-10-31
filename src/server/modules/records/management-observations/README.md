# 独立管理观察（BOW-904）

本目录承接没有情境/行为/结果也能保存的主观看法，保持 `kind: management-observation` 和 `nature: management_observation`。不生成关键事件、不调用评分或匹配 producer、不调用模型。当前交付只有领域校验、记录/来源权限投影和显式事务端口用例，**尚无 PostgreSQL 表/适配器、最终迁移或档案读取接线**。

输入是内部用例协议，不修改或替代共享 person/record DTO。节点和来源类型实际消费 899 固定 `96fa3aa8e9858c76db2125ac5ab79764f45d45ab`（含897冻结），不是复制节点模型；897状态/动作分歧不在这里选边。起点 main `5726fd5` 与该依赖普通 merge 后的组合为 `acfbcf925e51e8f0ef1be6ac3b77475abe761da2`。899/#222未合入，当前PR不能ready-to-merge。

## 行为

- `createManagementObservation` 的手写输入只有观察正文、发生日期/时间、节点/人员、出处引用和操作ID；作者由当前服务端身份及姓名绑定。没有SBI或打分字段，员工不能通过传author/role/确认标记取得权限。
- 面评导入要求当前范围内HR；正文、面试官署名、面试日期和全部出处须与服务端 `loadAttribution` 提供的固定解析记录一致，不能把HR改写的文字继续署名面试官。`occurredAt` 保留来源日期/时间精度，`recordedAt` 单列导入时刻。导入人与面试官分开；即使面试官映射到已有personId，`authorUnconfirmed`仍为true；未知面试官保留null身份，不按名字猜人。导入不是本人确认。
- 管理者/HR按899的当前节点与人员范围读取；作者仅在当前评价关系内看自己的记录，不开放他人的管理观察。员工、系统管理员、到期或撤销的评价关系拒绝；作者ID不会成为永久访问权限。
- 所有来源片段都须解析到原件版本、位置与完整主体/性质，并关联该观察的人员/节点。任何缺失、重复、错版本、其他主体或当前不可读的混合来源都会使整条记录不可投影。作者回看不自动授予整份原件或其他敏感性质的访问权。
- 输出是显式字段白名单；不暴露内部operation/attribution或录入账号字段。当前内部导入人元数据只随获授权的整条记录呈现。手写记录可无附件，出处是记录自身的署名/发生时间；不伪造原件片段来满足旧person DTO的min(1)。面评导入必须有真实出处引用。

## 事务端口的约束

`ManagementObservationPorts<Tx>` 没有默认内存生产实现。调用者必须提供真实事务、按已认证account+operation的锁、锁后当前账号/授权/时钟、来源完整分类、可信解析署名、观察/操作回执存储与审计。`accountId` 由会话/入口解析，不能来自请求里的role或任意账号。

创建顺序为锁→载入当前事实→原件/署名校验→观察/操作回执/审计→等待全部来源查询结束→最终重载当前权限→同步投影返回。成功重放重核当前权限/来源，同键异内容冲突，不重写历史或重复审计。读取也在全部异步来源查询后才取得最后权限快照，无后续异步查询夹在该检查与输出之间。

未来PG适配必须使用原生事务/锁后的权限读取，并锁定必要授权及来源分类栅栏，保证并发撤权、引用关系变化与写入/返回之间的原子性；仅重新读取对象不能替代数据库并发验收。观察、actor-operation回执与审计须同事务提交，任一步失败整体回滚。生产敏感读取审计仍由既有读取入口/平台组合落实，不能把本目录的内存端口回滚测试当作它已经接线。

## X1 整合与未验收项

X1已在 #248/6548149537 明确 `records/management-observations/schema.ts`、`postgres.ts` 和PG测试窗口；本次尚未创建这些文件，执行阻点记录于 #248/6548224363。建议唯一独立观察表及来源关联复用899节点/主体、records原件片段复合外键，不复制节点/身份/原件、不镜像搬迁旧 `records_statements`。现有Drizzle扫描支持子目录schema，暂不需要改 `programs/schema.ts`；902结论文件与本目录互斥。

公共records出口、person-data/projection/夹具/共享DTO、来源读取当前授权与敏感读取审计，继续由X1协调。最终迁移由X1在854之后、918/919之前串行生成；不在本卡提交SQL/meta。接线后还要验证真实PG持久读回、FK/幂等/回滚/并发撤权、无events/scores副作用、实际854匹配链过滤及档案/原件读取。独立用例通过不关闭整卡。

## 验证

本卡测试只用演示化名，实际调用领域/899授权函数；用内存端口检验编排、回滚契约和异步撤权，明确不算PG。单测最多2workers。覆盖率仅统计本卡四个实现文件，不含测试辅助。

```sh
pnpm exec vitest run src/server/modules/records/management-observations src/server/usecases/management-observations.test.ts --maxWorkers=2 --coverage --coverage.include='src/server/modules/records/management-observations/{model,policy,read}.ts' --coverage.include='src/server/usecases/management-observations.ts'
pnpm exec tsc --noEmit --incremental false
pnpm exec eslint --max-warnings=0 src/server/modules/records/management-observations src/server/usecases/management-observations.ts src/server/usecases/management-observations.test.ts
pnpm check:boundaries
```

全仓类型检查目前仍受899已知 `person-test-helpers.ts:107` 缺evaluationNodeId阻塞，作者不跨写受控夹具，也不删断言或放宽类型来掩盖。PR记录精确受检SHA、实际测试结果和CI终态。854固定 `71a586b68ad2c54ea8a9a51aa5bd1754663722b2` 的真实性质过滤可另在只读组合验证；不复制其实现，不把该片验证视为完整匹配或真实调用。
