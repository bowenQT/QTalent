# 面评 PDF 确定性解析（BOW-900）

`parseInterviewReviewPdf(bytes, options)` 读取 PDF 文字坐标与矢量绘图流，不调用模型。仅返回原表材料，不认人、不入库，也不生成 Niu-Talent 的正式维度分。导入用例必须先完成服务端身份与原件访问授权，再提供字节；后续人工核对与档案投影由 BOW-906 处理。

## 当前证据边界

**正式模板指纹尚未冻结，本交付保持 Draft。** BOW-896 / PR #251 的首批提交 `ef4c37b0ae1c1a5e7b5ad111fc9412a5eaa4ecee` 只有合成兼容样例。三套官方模板的可分发维度名、字段、选项与版式规格尚缺，不能以生成器和解析器相互验证替代真实模板兼容证明。解除条件见 [#223](https://github.com/bowenQT/QTalent/issues/223)。

当前内置三套名称仅属于 `bow-896-synthetic-v1` 演示指纹：校招专业面试通用评价表、七牛面试评价表-HR、七牛面试评价表-专业面试官；公共演示维度为专业能力、潜力、沟通协作、管理能力。API 默认返回 `unverified_template_profile`。只有显式传 `allowSyntheticDemo: true` 且 PDF 本身带「化名演示」标记，才启用这组演示指纹；输出始终带 `demo: true` 和指纹版本。

正式规格补齐后，需要另加经过证实的模板定义、独立来源夹具与回归，再开放正式识别。不能直接去掉演示门禁。

## 使用

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
- `rejected`：未知模板、维度缺失/改名/重复/额外行、缺少明细，或未经证实的正式指纹。
- `InterviewReviewPdfError`：PDF 无法读取，保留 `cause` 供受控诊断。解析器不记录原文或凭证。

每个识别值保留 `page + box`；页码从 1 开始，坐标为未旋转页面的 PDF point、左上原点、`[x0, y0, x1, y1]`。选择的 `value` 保留原量表文本（例如 `4`、`B`、`N3`），不能换算为能力总分、百分比或正式分。元数据保存文字原文和区域，包括面试时间、类型、面试官、面试结果、综合评价；模板名及区域另列。保留明细评语换行，忽略概览重复评语。

## 实现与验证

`pdf-layout.ts` 适配已选的 `pdfjs-dist@6.4.299`，读取文字与 `getOperatorList()`；只使用本地 CMap/字体数据、关闭注释，完成或失败后销毁任务。蓝灰圆形通过填色/描边判定，跟踪保存/恢复、坐标变换、Form、裁剪和透明度；未知颜色、复杂混合组等交人工处理。演示版式排除固定页眉/页脚，HR 职级续页保留原页码。

这层依赖 PDF.js 固定版本的绘图协议，升级时应重新验证。接口与绘图协议参考 [PDF.js API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html) 和 [官方 Canvas 实现](https://github.com/mozilla/pdf.js/blob/master/src/display/canvas.js)。依赖加入由 X1 统一处理，见 [#248 请求](https://github.com/bowenQT/QTalent/issues/248#issuecomment-6546011406)；本 PR 不修改 package.json 或锁文件。

定向单测使用自己生成的最小 PDF；另外独立读取 q896 固定提交的 PDF 及 manifest 核对三套选择、原文、来源区域、缺选、多选和跨页。两者都只证明合成演示行为。

```sh
pnpm exec vitest run src/server/modules/records/attachments/interview-review/interview-review.test.ts --maxWorkers=2
pnpm exec vitest run src/server/modules/records/attachments/interview-review/interview-review.test.ts --maxWorkers=2 --coverage --coverage.include='src/server/modules/records/attachments/interview-review/*.ts'
```

完整检查遵守主仓的 `resource-heavy-1/2` 双槽规则；单测最多两个 worker。没有数据库、迁移、worker 注册或开发服务。
