# 材料出处持久化边界（BOW-926）

本目录消费最终 BOW-897 契约（`e4462114690191fb9cbcd403f6fb0090bd3cfddb`），以现有 `records_fragments` 为唯一片段存储。当前提交先实现位置 codec 和 PDF 确定性投影；尚未实现数据库 writer/reader、权限装配或生产接线。

## 已有纯规则

- `location-codec.ts`：复用已有严格契约校验旧四类与新增五类位置，固定键序列化，不默认填值、不改变旧四类含义。`snapshot_field` 仅是旧存储兼容，不成为材料成功结果。
- `projectAttachmentPdf`：接受 [866 冻结的页面文本接口](https://github.com/bowenQT/QTalent/issues/248#issuecomment-6560298661)，按片段身份一对一关联 `pdfText.ranges`，保留真实 `parseVersionId` / `fragmentId` / `originalVersionId`。不从旧 `pdf:items` 序号猜字符偏移。
- `projectPdfParse`：核对独立加载的原件/内容摘要/parse/parser/投影版本绑定；保留空白物理页，拒绝缺页、重复页、重复片段身份、跨原件、越界或切开 UTF-16 代理对的范围；要求原文精确回切相等。无 trim、换行替换、搜索附近同文或 Unicode 修补。
- `verifyPdfParse`：重算逐页 SHA-256 与整包摘要，检测页面、片段或结果摘要不一致。摘要用于完整性及幂等比较，不是签名或权限证明。

页面提取算法唯一来源为 866 `pdf-page-text-v1`：同次受限 decode 的 TextItem 原序 `str`，`hasEOL` 后一个 LF；空页、旋转/被语义过滤项仍保留在页面文本。926 不再次解码或定义另一种页面顺序。旧 items-v2 的身份和内容不在本目录改写。

整包摘要使用 `SHA256(UTF8(JSON.stringify(['pdf-projection-bundle-v1', result])))`；result 为严格校验重建的 binding、按物理页升序的 pages（原 text 与 textDigest）、按 fragmentId 码元序排序的完整 fragments。页摘要是原 text 的 UTF-8 SHA-256。拒绝不完整 Unicode 代理项，避免 UTF-8 替换导致摘要丢失信息。输入页文本及 fragment 身份都不因排序重编号。

`expectedBinding` 必须来自服务器独立核实的原件版本及实际 parse 事实；`serverProvenance` 来自服务器确定的材料上下文，不能从客户端 locator 或材料种类推断。调用者不得把同一请求复制为 expected。纯规则没有资格授予来源读取权，也不校验原件字节：原件摘要先由实际解析/私有上传边界验证。

## 本片代码依赖与验收范围

- 仅依赖现有 Node crypto、Zod 和最终来源契约；没有新增共享依赖或 SQL。
- 单测使用明确合成的页文本与解析 bundle。它们验证范围与绑定规则，不是实际 PDF decode、数据库或授权验收。
- 本片可用 `pnpm exec vitest run src/server/modules/records/material-sources --maxWorkers=2` 验证。

## 整卡仍需完成

- 消费 X1 [已冻结的共享结构](https://github.com/bowenQT/QTalent/issues/248#issuecomment-6560249330)：不可变 materialParses、复合绑定的 fragments、materialPdfPages；最终迁移由 X1 在 846→845→873 之后生成。
- 使用既有 job attempt/revision/cancel 事务完成真实 canonical 写入、幂等重放及首次整理入队；不以任务 JSON 或内存结果代替持久化。
- 通过新连接读取五类位置，验证旧四类升级保真、版本/摘要/身份冲突、事务回滚及失败关闭。
- 复用既有当前权限策略，先汇总完整共有人和 requiredKinds，再过滤；接通真实受控读取与消费者，不复制另一套权限。
- 866 实现固定 SHA 的真实合成 PDF 联验、901/905/906 实际输出适配、845 canonical loader、873 可信上传上下文仍需各责任方交付。当前没有应用入口调用此纯规则。

此目录不读原始员工资料、不调用模型、不开下载端点；同页 bbox 不转换成字符范围。BOW-926 在上述剩余验收完成前保持进行中。
