# Office 原文提取（BOW-901）

`parseOfficeBytes({ format: 'pptx' | 'xlsx', bytes, signal? })` 只接收内存字节，返回原件 SHA-256、冻结定位版本、原文片段与 `attribution: 'unresolved'`。低层入口在 `parse.ts`，返回类型和稳定失败类别在 `types.ts`。不可信原件应经本目录新增的 `parseOfficeIsolated` 执行，不能直接在业务事件循环中调用低层解析器。不读路径、请求 URL、调用模型、执行公式或宏，也不写档案、分数或数据库。

- PPTX 按 `presentation.xml` 的实际幻灯顺序读取正文和备注，分别产生 `slide_text` / `speaker_notes`，同页使用 `{ kind: 'presentation', slide }`。备注按关系绑定，不按文件名数字配对；被移除的幻灯部件不成为页面。缺页序、缺目标或复用备注的歧义文件明确失败。
- XLSX 用原工作表名称与原单元格地址 `{ kind: 'spreadsheet', sheet, cell }`，稀疏位置、隐藏行/列/表如实保留。合并单元格只读原始存值，不向跟随单元格填值。缺少工作簿声明、孤立工作表、重复地址和未知类型不猜测恢复。
- XLSX 共享字符串和内联字符串的每个 `<t>` 按 [ST_Xstring](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/d34ae755-c53f-4a44-a363-c6dd3ee018a4) 单次还原 `_xHHHH_` UTF-16 码元，再拼接富文本；`甲_x000D_乙` 还原回车，`_x005F_x0041_` 保留字面量 `_x0041_`。不递归解码、不跨富文本节点创造转义；XML 实体仍由 XML 层先处理，原 `<v>`、原件字节和定位不改。
- `constant` 与 `formula` 分开。公式保留表达式、种类、共享索引和范围；`cached.state` 明确区分 `present` / `missing`。仅 `<v>` 的缓存参与文本提取；缺缓存的 `text` 是 `null`，不当作 0 或成功重算。合法空文本是 `''`，布尔假是 `false`，数字保留十进制原字串，避免大整数舍入。`raw` 是原 `<v>` 的字面值（内联文本没有 `<v>`，为 `''`）。日期序列数保留数字，不推断显示格式或时区。共享公式跟随项不补算表达式。
- 人名、团队归属、原量表的含义与身份均不推断。团队结果只在原单元格出现一次，不复制给成员；下游必须明确完成人工/服务端归属与权限流程。

定位形状来自 BOW-897 冻结 `0b20a913621121848219e0966ba4bf4844d1bdb3` 的 `materialSourceLocationSchema`；本目录的窄类型仅用于独立提取，不是授权 DTO 或另一个契约。冻结源码不复制、不修改。源码 SHA 常量不表示已接通原件读取或授权。

## 支持范围与失败

只提取 OOXML 中可读文本和缓存。图片 OCR、图表/嵌入对象解释、批注、母版文字、数字显示格式不在本入口范围；没有可用正文/备注/单元格时返回 `unsupported_content`。受支持的工作表、幻灯、备注部件采用标准 `sheetN.xml` / `slideN.xml` / `notesSlideN.xml` 命名及过渡版 OOXML 命名空间；其他布局、旧二进制/加密文件和损坏文件明确失败，不承诺任意 Office 导出兼容。

`OfficeParseError.kind` 是 `unsupported_format`、`invalid_document`、`unsupported_content`、`limit_exceeded` 或 `cancelled`。`reason` 只带稳定原因码，不透传供应商堆栈或原文。解析库对未完整读取内容发出的 warning 一律转为失败，不把剩余好页伪装成完整成功。

固定上限：输入 8 MiB、ZIP 部件 1024、总展开 32 MiB、工作表单元格 20000、总输出文本 200 万字符；另配置库的 XML 元素、重复内容与原始 AST 文本预算。在中心目录元数据解码之前，fflate 流式检查所有 ZIP 部件的实际展开字节与条目数，包含未引用部件；不能依赖可伪造的 originalSize。之后仍保留既有元数据和解析库预算，单元格上限独立于库按输入大小放宽的预算。禁用远程资源、OCR 和附件提取。只消费缓冲区，不追随外链。`AbortSignal` 支持预取消和库的检查点，**无法中断同步 XML/ZIP 解析中的事件循环**；本次新增真实线程调用器覆盖这种阻塞，但低层函数自身仍不能抢占；应用接线必须选择隔离调用器，不能把低层函数当作完整超时沙箱。

## 真实 Node 线程入口

`parseOfficeIsolated(input, options?)` 位于 `parse-isolated.ts`，实际启动固定的 `parse-worker.ts`，调用原 `parseOfficeBytes` 后返回同一个 `ParsedOffice` 结构。生产入口不接收路径、代码或测试模式。调用方的 Buffer 可能来自池或切片：先校验最多 8 MiB，再复制精确范围并 transfer 自有 ArrayBuffer，不暴露相邻字节，不 detach 调用方。线程使用现有 Node 24 / tsx，环境为空，不继承供应商凭据或父进程 execArgv。

```ts
import { parseOfficeIsolated } from './parse-isolated';

const parsed = await parseOfficeIsolated({ format: 'xlsx', bytes, signal });
```

父线程的墙钟截止和 AbortSignal 独立于解析线程的事件循环；超时、取消、结果、错误、无结果退出都进入一次性终态处理，**等待实际 `worker.terminate()` 完成后才返回或抛错**。不自动重试。解析错误保留 `OfficeParseError` 的稳定类别/原因；线程启动、协议或崩溃等基础设施故障使用 `OfficeIsolationError`，kind 为 `processing_failed`，超时/消息/诊断超限为 `limit_exceeded`，取消为 `cancelled`。错误不携带第三方堆栈或原文。

默认线程预算（只允许收紧，不能从调用参数放宽）：

| 预算        | 默认值及作用域                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------- |
| 墙钟截止    | 60 秒，覆盖线程加载与实际解析；父线程到期执行终止                                                             |
| JS 老生代堆 | 256 MiB，栈 4 MiB；Node 的线程 resourceLimits，**不是整个线程或进程的 RSS 硬限**                              |
| 结果        | 整个版本化 JSON 消息 UTF-8 最多 16 MiB，包含公式、raw/value、定位与包装字段；线程发送前和父线程解码前分别检查 |
| 诊断        | stdout + stderr 累计 64 KiB，私下消费并丢弃，超限终止；不写原文日志                                           |

这些预算不代替既有输入、32 MiB 实际 ZIP 展开、XML/单元格/文本上限。流式实际展开计量以 1 KiB 压缩输入块推进，允许解码器当前块的瞬时分配；没有宣称总 RSS 限制。Node 线程也不是 OS 安全沙箱或进程级容器限制。

私有协议只接受有界 UTF-8 字节，再做严格 Zod 校验；校验 format、原件 SHA-256、既有定位契约 SHA 与片段类别。成功输出保留原公式/缓存/空值与 unresolved 归属，没有另一套匹配或评分逻辑。完整消息预算不能用只统计可见 text 的预算替代。

这里只证明仓库源码形态下 Node/tsx 的真实调用。尚未验证 Next 生产产物是否携带/装载该 TS worker，也未接队列、权限、原件读取或持久化；不能称生产入口完成。tsx 当前仍沿用项目既有声明与启动方式，不据此推断仅生产依赖安装的部署产物可运行。

## 依赖与 X1 交接

X1 已在原分支 `de5c3750ac5f4163f9862a4bed95052f607e8439` 显式声明直接依赖（均 MIT）：[officeparser 8.4.1](https://github.com/harshankur/officeParser)、[@xmldom/xmldom 0.9.12](https://github.com/xmldom/xmldom)、[fflate 0.8.3](https://github.com/101arrowz/fflate)，并整合根锁与低层公共出口。本轮使用根锁冻结安装，无临时依赖 manifest 或传递依赖替代；不再把旧缺依赖失败当当前阻点。本轮不修改共享 package、lock 或公共出口。

OfficeParser 提供实际 PPTX 文本/备注 AST 与有预算的 XLSX 原始工作表 XML。薄适配层用 xmldom 读取缓存语义，fflate 负责 ZIP 元数据和少量工作簿/共享字符串部件。普通 AST 会省略未缓存公式和部分空字符串；实测 ExcelJS 4.4.0 也会丢掉公式缓存 0/false，因此本入口不把普通 AST 单元格当作完整来源事实。

共享文件请求登记于 #248，交 X1 处理：

1. root dependency 三项与锁文件、低层 `parseOfficeBytes` / `OfficeParseError` / 返回类型公共出口已由 X1 完成。新增隔离入口仍只在本目录，公共出口若要接入须由 X1 追加；不要把内部 XML/ZIP 或线程协议辅助公开。
2. 共用整理任务端口：当前权限校验后载入授权原件字节，调用本解析器，为片段分配稳定 `fragmentId` / `originalVersionId` / 解析版本，持久化定位，再进入同一个整理任务。原件摘要不是授权，不可从文件名、人名文本或团队结果推断个人映射；空文本/缺缓存须继续保留其区别。
3. 服务端读取、工作队列、持久化、幂等、隔离调用器的应用接线与原件 UI 返回均未完成。依赖 897/#220、873/#65 实际合入并组合验证前，本 PR 保持 Draft，不进入 ready-to-merge。

## 可复核验证

`parse.test.ts` 直接解析 `tests/fixtures/office` 的纯合成 ZIP/OOXML 字节，并用真实 ZIP/XML 修改制造失败输入。没有 mock 解析器输出，没有真实员工文件、模型或网络服务。 `spreadsheet.test.ts` 另以真实合成 XLSX 包覆盖共享/内联/富文本的转义、回车、代理对、伪形似文本、重复引用与稀疏定位，并核固定真实 worker 的完整输出等价。测试覆盖页序/备注配对、缓存与常量、0/false/空/缺失、大整数、隐藏行列、团队合并值不扩散、声明歧义、损坏/未知内容、固定预算和外链不发起 fetch。

```sh
pnpm exec vitest run src/server/modules/records/office --maxWorkers=2 --coverage --coverage.include='src/server/modules/records/office/*.ts'
pnpm exec tsc --noEmit --incremental false
pnpm exec eslint src/server/modules/records/office
pnpm exec prettier --check src/server/modules/records/office tests/fixtures/office/README.md
pnpm check:boundaries
```

这些命令需要 X1 已显式声明依赖，或如实记录隔离验证依赖。冻结契约兼容检查另在固定 897 只读 checkout 上，将真实提取出的每个 locator 交给该版本 schema 校验；结果与受检 SHA 写 PR。单元测试不代表共用任务、数据库、当前权限或原件 API 的运行时验收。完整重检查遵守 #248 的 heavy 双槽，单测始终 `--maxWorkers=2`。

本次隔离增量的目录验证为 76/76，行 94.38%、分支 87.50%、语句 93.44%、函数 98.03%；没有排除新增逻辑。包含三份真实 PPTX/XLSX 的线程内外完整输出等价、原件切片不变、低报 ZIP 声明仍超实际预算、条目/文本/完整消息限额、损坏原件和实际线程崩溃/空退出。超时与取消先观察共享计数器确认线程已进入 CPU 计算，再断言返回时 threadId=-1；受控删掉 terminate 后该测试确实因线程仍存活而失败，随后源码逐字恢复、测试清理真实线程。故障测试只在测试启动边界换成实际受控线程，生产没有测试开关；正常输出与预算路径使用真实固定 Office worker。

另在不经过 Vitest/mock 的 Node24/tsx 进程运行三份固定夹具，结果与低层原解析输出一致、调用者字节未变，37 条实际 locator 交给固定 897 原 schema 验证。受检 SHA、命令和 CI 终态以 PR 证据为准；新 head 需 Claude Code 审查，不沿用旧 head 的结论。未执行本机完整 check/集成/e2e/visual，未连接 PG 或供应商，未部署。
