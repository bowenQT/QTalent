# BOW-871 本期跨域业务回归

本增量仅补跨域缺口，不代替业务 PR 自带测试，也不关闭 BOW-871。不修改业务、前端、共享 runner、依赖、迁移或覆盖率门槛。

## 九个真实 PG 用例

| 用例                     | 证明的业务边界                                                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| 面评确认、重放、撤回     | 真 HR 事务→历史量表→新连接池档案读取→canonical PDF 原文；原量表 2/4/3 与面试官/导入人分开，维度确认和象限不变，撤回留历史/解析/审计     |
| 同节点角色隔离           | 真 evaluator relation 和员工账号均不能继承 HR 入档/来源读取权限；数据库不变                                                             |
| HR 撤权                  | 当前 grant 撤销后旧确认与新连接池原文读取都拒绝，旧历史不改写                                                                           |
| TXT / DOCX / PDF（各一） | 实际上传授权/归档→实际解析/PG→明确的已登记范围夹具前置→真实 bind/pg-boss/845→人工确认/撤销；来源版本/片段/定位与正式事件对应            |
| 未定身份与进程重建       | 未知范围 staged 上传经过实际解析后持久待核对；bind 被拒、模型为零、草稿/正式事件为零；进程重建及队列真实重投仍保留一份 parse 与未知范围 |
| 排队前后真实权限         | 越权账号不能取得集合；排队后真实 relation 撤销导致解析拒绝、零模型/草稿                                                                 |
| 人员绑定撤销与846        | 真 undo 后保存旧草稿被拒；rebind 不复活旧草稿；新草稿真实确认后绑定 undo 冲突且事件/确认/草稿不变                                       |

TXT 正例另在 parse/待核对提交后结束旧测试进程，真实绑定在无消费者时持久入队；新进程消费成功后再真实重投同一 generation，断言草稿 ID/数量不变且模型总调用仍为 1。测试进程组合真实生产 factory、实际注册函数与 `afterParse/afterRecovery`；**不是部署命令 `src/worker/index.ts` 的验收，也不称 OS 重启**。共享部署入口注册另由业务/集成测试负责。

## 必须保留的证据分层

- 数据库复用 `tests/fixtures/bow-845/native.ts`：唯一 loopback `_test` 库、正式迁移、合成目录。缺 `TEST_DATABASE_URL` 直接失败，不 skip。
- 面评 seed 调用生产 `importInterviewImportDemo` 解析固定摘要的演示 PDF，不预置成功历史；旧 parsed 不是 canonical 时使用实际归档事务产生的版本。
- 附件集合、当前权限、grant 与归档使用生产 `createMaterialUploadRuntime`。只有既有 `createTestKodo` 是外部对象存储替身；不使用 `canWriteTarget: () => true` 作为权限证明。
- **普通 staged 上传目前没有完整范围 capture producer。** 成功用例的 `seedAlreadyCapturedAttachmentScope` 显式建立“已有可信完整范围”这一合成持久前置，包含对应测试审计；不是生产范围采集/确认 API，也不能据此声称普通上传已自动闭环。R7 不建立此前置，必须保持待核对、零模型。范围与人员行为归属分开；绑定归属仍走实际897命令。
- 模型使用真实 HTTP adapter/schema/引用校验，仅 provider transport 返回离线合成响应。原件字节、parser、授权、PG、队列、业务状态机均真实。
- 测试直接选择真实绑定账号调用服务端事务/请求工厂，不接受客户端自报角色；这不是 Cookie 登录或浏览器验收。React、正式面评模板、真实 Kodo/Modelink 和部署没有在此宣称通过。

## 执行

```sh
pnpm exec vitest run --config vitest.integration.config.ts \
  tests/e2e/bow-871/interview-archive.integration.test.ts \
  tests/e2e/bow-871/attachment-business.integration.test.ts --maxWorkers=2
```

子进程由测试启动和清理，正式迁移由 `nativeDatabase` 执行。根依赖/共享文件由集成方提供，不在本 PR 复制业务变更。`business-worker.ts` 只在显式 Node 执行时启动；Vitest 导入外部响应夹具不会启动 worker。

## 当前实测状态

规格经独立复核通过（SHA-256 `6b45de52332232c3bc894650fe7560d8138a4e682fffd78272b700c8cba12ecd`）；本轮根据所有者“暂不增加范围确认交互”收窄成功前置，绝不伪造普通上传的范围采集能力。

云端 PostgreSQL 17.10 的 Unix socket 被沙箱拒绝，官方 escalation 在启动前 bwrap 挂载失败；没有绕过，也没有本云端真实 PG 通过结论。两套共九项已实际收集，命令 exit 1：面评3项在 beforeEach 失败，附件6项因 beforeAll 同样缺 TEST_DATABASE_URL 未执行（runner 标为 skipped，不是源码 skip），无任何 PG 通过结论。最终九项/完整 CI 以 PR 当前提交的实际结果为准，未跑不记通过、不降门槛。独立代码审查及必要 CI 通过后才 Ready for review，不合并。
