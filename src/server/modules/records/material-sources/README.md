# 材料出处持久化边界（BOW-926）

本目录消费最终 BOW-897 契约（`e4462114690191fb9cbcd403f6fb0090bd3cfddb`），以现有 `records_fragments` 为唯一片段存储。当前提交实现位置 codec、PDF 确定性投影、canonical writer、实际权限 reader 与 PDF 保存适配；公开路由、完整媒体生产接线及正式迁移仍待完成。

## 已有纯规则

- `location-codec.ts`：复用已有严格契约校验旧四类与新增五类位置，固定键序列化，不默认填值、不改变旧四类含义。`snapshot_field` 仅是旧存储兼容，不成为材料成功结果。
- `projectAttachmentPdf`：接受 [866 冻结的页面文本接口](https://github.com/bowenQT/QTalent/issues/248#issuecomment-6560298661)，按片段身份一对一关联 `pdfText.ranges`，保留真实 `parseVersionId` / `fragmentId` / `originalVersionId`。不从旧 `pdf:items` 序号猜字符偏移。
- `projectPdfParse`：核对独立加载的原件/内容摘要/parse/parser/投影版本绑定；保留空白物理页，拒绝中间缺页、重复页、重复片段身份、跨原件、越界或切开 UTF-16 代理对的范围；要求原文精确回切相等。无 trim、换行替换、搜索附近同文或 Unicode 修补。
- `verifyPdfParse`：重算逐页 SHA-256 与整包摘要，检测页面、片段或结果摘要不一致。摘要用于完整性及幂等比较，不是签名或权限证明。

页面提取算法唯一来源为 866 `pdf-page-text-v1`：同次受限 decode 的 TextItem 原序 `str`，`hasEOL` 后一个 LF；空页、旋转/被语义过滤项仍保留在页面文本。926 不再次解码或定义另一种页面顺序。旧 items-v2 的身份和内容不在本目录改写。纯投影输入尚无独立页数，因此不能识别首次发布前遗漏的末尾空页；完整生产页数由866实际decoder遍历保证。已保存整包摘要能识别读回时的末尾页截断，不据此声称首次输入完整性已由926独立证明。

整包摘要使用 `SHA256(UTF8(JSON.stringify(['pdf-projection-bundle-v1', result])))`；result 为严格校验重建的 binding、按物理页升序的 pages（原 text 与 textDigest）、按 fragmentId 码元序排序的完整 fragments。页摘要是原 text 的 UTF-8 SHA-256。拒绝不完整 Unicode 代理项，避免 UTF-8 替换导致摘要丢失信息。输入页文本及 fragment 身份都不因排序重编号。

`expectedBinding` 必须来自服务器独立核实的原件版本及实际 parse 事实；`serverProvenance` 来自服务器确定的材料上下文，不能从客户端 locator 或材料种类推断。调用者不得把同一请求复制为 expected。纯规则没有资格授予来源读取权，也不校验原件字节：原件摘要先由实际解析/私有上传边界验证。

## 私有持久化

`store.ts` 在调用者真实 Transaction 内发布 materialParses / fragments / materialPdfPages，校核现有任务的 attempt、revision、inputVersion 和取消状态，复用现有 job 行锁；按 parse 业务键串行重放，完整不可变事实相同才返回 existing。原件版本/摘要从实际表读取，基线与缺失来源拒绝。调用者仍须先核当前写入权限，并在既有 commitJobUpdate 同一事务中，仅 created 时入首次整理队列。store 不自行新开事务或复制任务状态。

reader 核验全部 parse 片段、页面摘要及原件绑定，再返回私有事实；没有 parse 绑定的旧四类交给旧 reader，不猜来源类别。返回私有事实不授予网页或模型可见性，完整当前授权必须在对外输出之前完成。

真实 PG 套件先在正式历史迁移下写四类旧片段，再应用 X1 的受控原生验证目录（显式 `QTALENT_926_TEST_MIGRATIONS`），测试完成后删除独立 `_test` 库；默认仍使用正式迁移，不以临时编号冒充发布顺序。

## 本片代码依赖与验收范围

- 仅依赖现有 Node crypto、Zod 和最终来源契约；没有新增共享依赖或 SQL。
- 纯规则单测使用明确合成的页文本与解析 bundle；另有23项真实PG存取/围栏/事务及pg-boss验证，仍不证明当前权限与应用生产接线。
- 真实PDF联验在固定866 `17ce4a52ecba0fe8e459d7bd1e4a0e02d673d803` + main71f8d9组合完成：8项实际PDF→生产worker→projection通过。独立组合测试提交 `71af19025e70613f1b8bbb99e13562e37118a30f`，等X1接入真实parser依赖后纳入本分支默认回归，不更改#189作者源码。
- 本片可用 `pnpm exec vitest run src/server/modules/records/material-sources --maxWorkers=2` 验证。

## 整卡仍需完成

- 消费 X1 [已冻结的共享结构](https://github.com/bowenQT/QTalent/issues/248#issuecomment-6560249330)：不可变 materialParses、复合绑定的 fragments、materialPdfPages；最终迁移由 X1 在 846→845→873 之后生成。
- 接入866 saveParse与845真实整理入队；私有存取已通过既有job事务+实际pg-boss组合验证，但未等于应用运行器接线完成。
- 在X1最终正式迁移上复验现有五类新连接读回、旧四类升级保真、版本/摘要/身份冲突、事务回滚及失败关闭；当前仅受控临时验证迁移通过。
- 复用既有当前权限策略，先汇总完整共有人和 requiredKinds，再过滤；接通真实受控读取与消费者，不复制另一套权限。
- 866真实PDF已做固定组合联验；901/905/906实际输出适配、845 canonical loader、873可信上传上下文仍需各责任方交付。当前没有应用入口调用此纯规则。

此目录不读原始员工资料、不调用模型、不开下载端点；同页 bbox 不转换成字符范围。BOW-926 在上述剩余验收完成前保持进行中。

## 授权读取续作

`readAuthorizedMaterialSource` 在当前完整来源图上调用既有 `readTalentSource`，未通过全部共有人及 requiredKinds 权限时不查询 parse 详情；通过后按两 ID 从同一事务重载 canonical 整包，核对原件版本、摘要、位置和原文，再只返回最终897材料结果。数据库错误、绑定摘要、主体图和下载地址不进入返回值。旧无 parse 绑定的片段仍交原 reader，不推测类别。

`usecases/read-material-source.ts` 是已认证服务端 accountId 的领域入口：在同一 repeatable-read 事务内调用 X1 `loadPersonDataInTransaction` 与完整 `talentSources`，读取成功才写 `source.read` 审计；审计失败整组回滚且不返回原文。调用者不传入权限图、actor、locator 或缓存能力；此函数没有接 Web 路由或生成原件下载票。每次新调用重新读取当前账号绑定、角色、节点关系和业务时钟。事务内保持一致快照，不声称对快照建立后的并发撤权实行线性化。

共享出口已由 X1 导出 `readAuthorizedMaterialSource`。以下真实PG反例已在保全正式0000–0010前缀的受控结构上通过：五类位置、隐藏共有人/撤回事件、未知历史类别、无关联材料、撤权/到期/换绑、额外管理观察限制、身份拒绝、原件版本及摘要漂移、审计回滚、全量附件intake。受控结构逐文件与当前前缀核对；正式926迁移仍需X1按游标交付，临时结构通过不代表默认迁移门禁通过。

边界仍明确：X1现有 `confirmationSources` 只校验文本intake；附件intake没有可信原生绑定前继续失败关闭。873 `collection.target` 的 people/event 不能单独提供全部评价节点/期次/材料敏感类型，creator也不是来源全体主体。生产866 saveParse、873绑定及845入队尚未接通，本次 reader 不替代它们，更不把人工写入的PG测试夹具冒充真实附件任务运行。


## 同事务 PDF 保存适配

`saveAttachmentPdf(tx, binding, parsed, serverProvenance)` 是866 `saveParse` 的具体原生实现：在调用方完成事务中锁定当前media job，复核parsing阶段、输入版本与取消状态，调用873 `readValidatedUploadInTransaction` 持集合锁重读实际归档事实，逐项绑定账号/集合/目标/文件/字节数/摘要，再把固定页面文本decoder的真实输出投影并写入现canonical store。没有另开事务，也不改job或独立入队；失败统一安全错误，旧items-v2无页面文本不能进入此入口。

此适配只接PDF页面文本版本，不新增TXT/DOCX存储语义。`serverProvenance` 必须来自服务器已确认分类；null/未知类别失败，不按文件名或上传者猜类别。它不是授权函数，调用方仍须在同一完成事务先完成当前写权限、全部主体/node/kinds重验。当前私人适配尚未被生产worker装配调用，未完成材料intake分类时不得启用。

新增15项真实PG组合通过：873实际归档→866实际PDF worker→本适配→canonical片段/页/parse→真实pg-boss验证队列及job完成，同一完成事务全提交或全回滚；重投只保存/排队一次；解析期间撤权、绑定漂移、取消及attempt变化阻止写入，修改账号/目标/任务/版本/摘要/parser/范围/分类均失败。测试只在对象存储和未接的处理权限处使用明确替身；验证队列不是845材料producer。另在测试中明确建立正式事件关联后，调用实际授权reader回切原文/位置，再增加范围外共有人核拒绝。这证明实际存储与权限算法组合，不声称事件关联由生产媒体链自动创建。

当前本卡9文件268项统一通过（含真实PG、真实PDF及离线规则），本目录行覆盖97.59%、分支92.22%；新增保存适配行100%、分支96.77%。这些是受控结构结果，正式结构/全工程结果单独在PR记录。新适配、当前授权reader可独立审查；完整媒体intake分类、845 loader/入队、公共运行器注册及公开原件下载属于明确后继，不能把它们标为已完成。
