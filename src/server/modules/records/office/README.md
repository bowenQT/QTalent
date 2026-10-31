# Office 原文提取（BOW-901）

`parseOfficeBytes({ format: 'pptx' | 'xlsx', bytes, signal? })` 只接收内存字节，返回原件 SHA-256、冻结定位版本、原文片段与 `attribution: 'unresolved'`。入口在 `parse.ts`，返回类型和稳定失败类别在 `types.ts`。不读路径、请求 URL、调用模型、执行公式或宏，也不写档案、分数或数据库。

- PPTX 按 `presentation.xml` 的实际幻灯顺序读取正文和备注，分别产生 `slide_text` / `speaker_notes`，同页使用 `{ kind: 'presentation', slide }`。备注按关系绑定，不按文件名数字配对；被移除的幻灯部件不成为页面。缺页序、缺目标或复用备注的歧义文件明确失败。
- XLSX 用原工作表名称与原单元格地址 `{ kind: 'spreadsheet', sheet, cell }`，稀疏位置、隐藏行/列/表如实保留。合并单元格只读原始存值，不向跟随单元格填值。缺少工作簿声明、孤立工作表、重复地址和未知类型不猜测恢复。
- `constant` 与 `formula` 分开。公式保留表达式、种类、共享索引和范围；`cached.state` 明确区分 `present` / `missing`。仅 `<v>` 的缓存参与文本提取；缺缓存的 `text` 是 `null`，不当作 0 或成功重算。合法空文本是 `''`，布尔假是 `false`，数字保留十进制原字串，避免大整数舍入。`raw` 是原 `<v>` 的字面值（内联文本没有 `<v>`，为 `''`）。日期序列数保留数字，不推断显示格式或时区。共享公式跟随项不补算表达式。
- 人名、团队归属、原量表的含义与身份均不推断。团队结果只在原单元格出现一次，不复制给成员；下游必须明确完成人工/服务端归属与权限流程。

定位形状来自 BOW-897 冻结 `0b20a913621121848219e0966ba4bf4844d1bdb3` 的 `materialSourceLocationSchema`；本目录的窄类型仅用于独立提取，不是授权 DTO 或另一个契约。冻结源码不复制、不修改。源码 SHA 常量不表示已接通原件读取或授权。

## 支持范围与失败

只提取 OOXML 中可读文本和缓存。图片 OCR、图表/嵌入对象解释、批注、母版文字、数字显示格式不在本入口范围；没有可用正文/备注/单元格时返回 `unsupported_content`。受支持的工作表、幻灯、备注部件采用标准 `sheetN.xml` / `slideN.xml` / `notesSlideN.xml` 命名及过渡版 OOXML 命名空间；其他布局、旧二进制/加密文件和损坏文件明确失败，不承诺任意 Office 导出兼容。

`OfficeParseError.kind` 是 `unsupported_format`、`invalid_document`、`unsupported_content`、`limit_exceeded` 或 `cancelled`。`reason` 只带稳定原因码，不透传供应商堆栈或原文。解析库对未完整读取内容发出的 warning 一律转为失败，不把剩余好页伪装成完整成功。

固定上限：输入 8 MiB、ZIP 部件 1024、总展开 32 MiB、工作表单元格 20000、总输出文本 200 万字符；另配置库的 XML 元素、重复内容与原始 AST 文本预算。ZIP 上限在库解析前检查，单元格上限独立于库按输入大小放宽的预算。禁用远程资源、OCR 和附件提取。只消费缓冲区，不追随外链。`AbortSignal` 支持预取消和库的检查点，**无法中断同步 XML/ZIP 解析中的事件循环**；在未可信上传入口接线前，X1 仍须用已有整理 worker 的隔离/终止预算约束执行，不能把本函数当作完整超时沙箱。

## 依赖与 X1 交接

要求显式直接依赖（均 MIT）：[officeparser 8.4.1](https://github.com/harshankur/officeParser)、[@xmldom/xmldom 0.9.12](https://github.com/xmldom/xmldom)、[fflate 0.8.3](https://github.com/101arrowz/fflate)。本卡不修改共享 `package.json` / lock。X1 尚未添加前，裸仓库 CI 不能解析这些导入；本卡验证使用独立临时 package 的精确声明与忽略目录中的临时软链，不借用传递依赖。

OfficeParser 提供实际 PPTX 文本/备注 AST 与有预算的 XLSX 原始工作表 XML。薄适配层用 xmldom 读取缓存语义，fflate 负责 ZIP 元数据和少量工作簿/共享字符串部件。普通 AST 会省略未缓存公式和部分空字符串；实测 ExcelJS 4.4.0 也会丢掉公式缓存 0/false，因此本入口不把普通 AST 单元格当作完整来源事实。

共享文件请求登记于 #248，交 X1 处理：

1. root dependency 三项与锁文件；公开 `parseOfficeBytes`、`OfficeParseError` 和返回类型到 records 公共出口（不要把内部 XML/ZIP 辅助公开）。
2. 共用整理任务端口：当前权限校验后载入授权原件字节，调用本解析器，为片段分配稳定 `fragmentId` / `originalVersionId` / 解析版本，持久化定位，再进入同一个整理任务。原件摘要不是授权，不可从文件名、人名文本或团队结果推断个人映射；空文本/缺缓存须继续保留其区别。
3. 服务端读取、工作队列、持久化、幂等、超时进程隔离与原件 UI 返回均未在本卡独立目录接线。依赖 897/#220、873/#65 实际合入并组合验证前，本 PR 保持 Draft，不进入 ready-to-merge。

## 可复核验证

`parse.test.ts` 直接解析 `tests/fixtures/office` 的纯合成 ZIP/OOXML 字节，并用真实 ZIP/XML 修改制造失败输入。没有 mock 解析器输出，没有真实员工文件、模型或网络服务。测试覆盖页序/备注配对、缓存与常量、0/false/空/缺失、大整数、隐藏行列、团队合并值不扩散、声明歧义、损坏/未知内容、固定预算和外链不发起 fetch。

```sh
pnpm exec vitest run src/server/modules/records/office --maxWorkers=2 --coverage --coverage.include='src/server/modules/records/office/*.ts'
pnpm exec tsc --noEmit --incremental false
pnpm exec eslint src/server/modules/records/office
pnpm exec prettier --check src/server/modules/records/office tests/fixtures/office/README.md
pnpm check:boundaries
```

这些命令需要 X1 已显式声明依赖，或如实记录隔离验证依赖。冻结契约兼容检查另在固定 897 只读 checkout 上，将真实提取出的每个 locator 交给该版本 schema 校验；结果与受检 SHA 写 PR。单元测试不代表共用任务、数据库、当前权限或原件 API 的运行时验收。完整重检查遵守 #248 的 heavy 双槽，单测始终 `--maxWorkers=2`。
