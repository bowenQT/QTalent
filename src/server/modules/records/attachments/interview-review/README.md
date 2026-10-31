# 面评 PDF 确定性解析（BOW-900）

`parseInterviewReviewPdf(bytes, options)` 读取 PDF 文字坐标与矢量绘图流，不调用模型。仅返回原表材料，不认人、不入库，也不生成 Niu-Talent 的正式维度分。导入用例必须先完成服务端身份与原件访问授权，再提供字节；后续人工核对、原件版本绑定与档案投影由 BOW-906 处理。

## 当前证据边界

**正式模板指纹尚未冻结，本交付保持 Draft。** BOW-896 / PR #251 固定提交 `9533f64306ed68a6c2d2966474ef6d89033a5e31` 的面评 PDF 是合成兼容样例。三套官方模板的可分发维度名、字段、选项与版式规格尚缺，不能以生成器和解析器相互验证替代真实模板兼容证明。解除条件见 [#223](https://github.com/bowenQT/QTalent/issues/223)。

当前内置三套名称仅属于 `bow-896-synthetic-v1` 演示指纹：校招专业面试通用评价表、七牛面试评价表-HR、七牛面试评价表-专业面试官；公共演示维度为专业能力、潜力、沟通协作、管理能力。API 默认返回 `unverified_template_profile`。只有显式传 `allowSyntheticDemo: true` 且 PDF 本身带「化名演示」标记，才启用这组演示指纹；输出始终带 `demo: true` 和指纹版本。

正式规格补齐后，需要另加经过证实的模板定义、独立来源夹具与回归，再开放正式识别。不能直接去掉演示门禁。

## 使用与字段

```ts
import { parseInterviewReviewPdf } from './parser';

const result = await parseInterviewReviewPdf(pdfBytes, {
  positionKind: 'non_management',
  allowSyntheticDemo: true, // 仅显式演示环境
});
```

`positionKind` 由导入用例提供，解析器不根据职位字符串猜测。非管理岗位的管理能力为 `not_applicable`；岗位适用性未知时为 `applicability_unknown`，不会输出分数。

- `parsed`：原表适用行各有一个明确选择，所需元数据均存在；仍须后续核对。
- `needs_manual_input`：缺选、多选、选项数量/标签不符、图形不支持、适用性或元数据缺失。失败行没有 `value`，不能取第一个选项或按零分导入。
- `rejected`：未知模板、维度缺失/改名/重复/额外行、缺少明细，或未经证实的正式指纹。拒绝结果不返回可导入的 `reviews` / `pageTexts`。
- `InterviewReviewPdfError`：PDF 无法完整读取；`reason` 为 `invalid_content` 或 `resource_limit`，保留 `cause` 供受控诊断。解析器不记录原文或凭证。

选择的 `value` 保留原量表文本（例如 `4`、`B`、`N3`），不能换算为能力总分、百分比或正式分。元数据保存文字原文和区域，包括面试时间、类型、面试官、面试结果、综合评价；模板名及区域另列。保留明细评语换行，忽略概览重复评语。

`identity.candidateName` 只读取明细区显式「候选人：」后的姓名原文；缺失、空白或同一明细内出现冲突姓名时为 `null`，不匹配人员目录、不产生 personId。HR 续页重复同一姓名时保留各页原文引用。没有经过证实的职位编号标签或样例，因此 `identity.positionNumber` 固定为 `null`；不能用候选人 ID、建议职级或其他编号补位。这组可选原文数据独立于既有必需元数据，不改变 `parsed` 的旧必填判定。

## 文本与定位

成功或需补录结果同时返回 `pageTexts`。它是固定提取算法 `interview-review-lines-v1` 的逐页文本，页码从 1 开始；每页有 `text`、`extractionVersion` 与 UTF-8 文本的 `sha256`。PDF.js 文字提取禁用 normalization；按文字框从上到下分行、行内从左到右排列，同行 item 以一个空格连接，行间用 `\n` 连接。页眉、页脚、概览文本仍留在逐页文本中，明细识别过滤它们时不重排偏移。

每个 `PdfRegion` 的 `textRange` 是上述同页 `text` 内从零开始、左闭右开的 JavaScript UTF-16 偏移，必须用 `text.slice(start, end)` 回查。元数据引用覆盖其原文行；矢量选择引用覆盖维度/选项所在的文字行，**文字跨度只定位行上下文，选中状态仍来自绘图颜色**。它不把选中圆的坐标换算成字符位置。

`box` 仅作解析器内部图形溯源，坐标为未旋转页面的 PDF point、左上原点、`[x0, y0, x1, y1]`。向 BOW-897 冻结契约 `0b20a913621121848219e0966ba4bf4844d1bdb3` 提供 PDF locator 时，只投影现有三个字段：

```ts
const location = {
  kind: 'pdf',
  page: region.page,
  textRange: region.textRange,
};
```

该严格契约不接受 `box`。BOW-906 仍需把原件版本、提取算法版本、对应逐页文本与其摘要一同绑定和验证；定位有效不等于已获原件权限。完整 `pageTexts` 是受控来源数据，不是可以直接发给前端或模型的响应；下游必须沿用当前权限过滤与来源读取端口。

## PDF 预算与错误

`pdf-layout.ts` 使用已固定的 `pdfjs-dist@6.4.299`，仅访问本地 CMap/字体，关闭注释。创建文档后、读取任何页之前拒绝超过 200 页的输入；`maxImageSize` 对单张图片限制为 2,000,000 像素，超限明确报错，不接受丢图后的部分结果。

PDF.js 的公开 `getOperatorList()` 可能在真实 operator stream 失败后返回部分列表。本适配器只在当前文档的固定版本 transport 上观察 `GetOperatorList` 流并记住异常，再检查最终 chunk 与数组长度，拒绝部分绘图结果。通过真实 PDF 字节触发的缺失 shading 资源与超大图片验证此行为；它不声称捕获 PDF.js 的所有非致命 warning。每页释放缓存，完成或失败后销毁文档并恢复该文档的流方法。

这里没有独立 worker、硬时限或堆内存隔离，也没有总图片解码量预算。BOW-906 的隔离入口仍需负责这些外层限制；不能把本层页面/图片阈值称为完整资源隔离。

蓝灰圆形通过填色/描边判定，跟踪保存/恢复、坐标变换、Form、裁剪和透明度；未知颜色、复杂混合组等交人工处理。演示版式排除固定页眉/页脚，HR 职级续页保留原页码。升级 PDF.js 时必须重新验证本目录的绘图协议与私有流观察点。

## 验证

本次续作定向单测 49/49 通过；目录覆盖率：行 97.46%、分支 91.85%、语句 96.29%、函数 98.33%。包含真实 PDF 字节的 201 页失败、200 页通过、超大图片失败、绘图流异常失败、原文姓名可选性、跨页与非 BMP 字符 UTF-16 定位。修复前固定旧版本 `3ce3b9d3d5bc4b083fe8bc5cf632d5f39fef5287` 会对缺失 shading 资源返回部分 layout；本版本明确拒绝。

独立只读核对 BOW-896 固定提交中的 8 个面评场景及 1 个字节重复文件：逐文件 SHA-256、原量表选择、保留换行的完整评语、原文姓名、HR 第 3 页职级均符合合成样例预期；92 条真实文字范围能切回对应页，投影后通过实际 BOW-897 冻结 `materialSourceLocationSchema`，额外携带 bbox 会被拒绝。未知模板拒绝，缺选/多选无 value；目录外面试官只保留原文，不声称已匹配。重复文件仅验证字节与解析输出一致，不代表重复导入验收。上述验证都只证明合成演示行为。

```sh
pnpm exec vitest run src/server/modules/records/attachments/interview-review/interview-review.test.ts --maxWorkers=2
pnpm exec vitest run src/server/modules/records/attachments/interview-review/interview-review.test.ts --maxWorkers=2 --coverage --coverage.include='src/server/modules/records/attachments/interview-review/*.ts'
```

X1 已在原分支整合 PDF.js 依赖；本次续作不改 package.json、锁文件或公共出口。类型检查、定向 ESLint、边界检查、定向格式与 diff 检查通过。完整检查遵守主仓 `resource-heavy-1/2` 双槽规则；本次未运行完整 check/集成/e2e/visual，单测最多两个 worker。没有数据库、迁移、worker 注册或开发服务。旧 head 的 Claude Code 通过不覆盖此次新增字段/资源边界，新增 head 仍需增量审查。
