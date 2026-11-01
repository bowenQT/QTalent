# BOW-905 初始图片的原生读取组合

本片在独立后继分支消费 X1 `d44c88ad97480124c31e558f6085a78f7407843b` 与组件 #281 `2d2fd9e81d353fd153c98993347dec783ad1a518`。不修改 #281 的 Ready 头、不复制权限算法或更改公共结构。

`createNativeInitialImageGate(db, dependencies)` 将真实 `createInitialImageDisclosureReader(db)` 固定为 `loadCurrent`。调用方不能替换为许可快照；每次读取均使用真实 PostgreSQL 事务和当前目录/节点关系，读取结束即提交，再进行对象字节获取、实际裁剪或模型 I/O。沿用现有门禁在读后、裁后及模型返回后的重核，不跨网络持锁。

## 可运行边界

仅支持 X1 已冻结的初始图片范围：本人创建、无项目、同批明确媒体集合，原件全部主体来自可追溯的 `material.capture` 审计，当前 image_scope 操作/回执/修订一致，当前上传成员与节点许可有效。首次 OCR 的 source 为 null；已有 canonical 的材料由本 reader 拒绝，不能伪造 fragment 来扩大入口。

裁剪仍是 #281 实际 Sharp 实现。`readOriginal` 必须显式提供有界对象读取，Modelink 客户端与预算也必须显式提供；本片没有默认许可、默认存储或生产注册。这次交付将真实数据库读取接入已有组件，不声称已经实现 Kodo 字节适配、采集写端、人工核对写端、canonical 发布或整理恢复。

## 真实 PG 联验

`native.integration.test.ts` 使用现有 `nativeDatabase()` 创建隔离 `_test` 库和正式迁移，再显式消费与固定 X1 头匹配的临时原生迁移。`native.fixture.ts` 只写合成上传/输入/原件/人工操作与真实审计行，不是生产种子或核对 writer。所有授权由真实 reader 重算，未注入 true 授权回调。

外部边界如下：

- 对象存储读取返回明确的合成 PNG 字节；实际摘要/长度校验和 Sharp 裁剪照常执行，不冒称已访问 Kodo。
- 模型使用实际 Modelink 协议 fake，截获并解码真正发送的 PNG；像素逐字断言只含批准的红色半图，不含蓝色半图，不冒称供应商实测。
- 裁后并发测试的调度钩子先执行真实 `cropMaterialImage`，再提交 SQL 修订；不替换裁剪结果或授权结果。
- 历史 undo 测试准备真实保留旧操作、当前 pending/新修订/空指针的数据库状态，验证读取不能复用旧许可；尚不宣称调用了未接通的原生 undo writer。

22 条 PG 用例覆盖首图、完整同批双材料与遗漏成员、跨批同原件范围约束、未知范围/错审计/非本人/项目/错摘要、释放/换绑/撤权/终态、已授权共同主体后续撤权、读后/真实裁后/模型等待期间变化、仅附件零读取零外发、处理中转附件、旧回执失效及错误对象字节。额外通过真实第二事务取得同一材料行锁，确认对象与模型 I/O 时 reader 已释放事务。

显式运行：

```sh
# 只从 test-db.env 加载测试库；先领 heavy 槽，固定迁移目录需核 manifest。
pnpm exec vitest run --config vitest.integration.config.ts src/server/usecases/material-images --maxWorkers=2
```

不读取 vendors.env，不发供应商请求。缺结构时失败，不加 skip 或伪造空表。默认 unit 排除本目录 integration，完整 CI 仍要求正式迁移真实覆盖。

## 未完成的生产接线与门禁

- **本 PR 代码前置**：X1 d44c88ad 的真实 reader/媒体结构及依赖组合、#281 裁剪组件。当前主干尚未全部包含，临时迁移不是正式交付，不能以组合 PG 通过转 Ready。
- **需要 X1 的准确后续**：正式迁移游标与公共组合；同当前材料/上传/版本绑定的有界原件字节适配；真实 capture/review/undo writer。数据库读取已可联验，不因这些缺口停掉本片。
- **整卡后续**：成功 OCR 的真实 job fence→926 canonical 发布→845 唯一恢复 producer、幂等/取消持久化、worker/用户入口与有限化名供应商验收。未在这里新增状态表、原件副本、正式事件或人工结论。

当前只能返回候选或明确失败/附件终态。后继 PR 要等实际代码/正式结构、当前 CI 等非审查门禁齐备才转 Ready；原 #281 独立片的 Ready 状态不受影响。Codex 不合并。
