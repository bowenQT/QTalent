# BOW-896 化名演示夹具

本目录仅包含从零撰写、从零排版的演示材料。未读取或复用真实 PDF、评语、群聊、录音，也未读取 `docs/sources/`、`docs/design-refs/`。人员身份只取固定原型参照 `451ecec` 的化名目录；只复制 id 和姓名，不复制人员评价、学校、履历或项目原话。

## 版式证据边界

依据 [BOW-896](https://linear.app/bowenzhong/issue/BOW-896)、[BOW-900](https://linear.app/bowenzhong/issue/BOW-900) 的文字规格重建：三套模板名、带 Logo 的页眉、明细页、蓝色选中 / 灰色未选的矢量单选框、1–5 / S–D / 建议职级选项、HR 职级续页、概览页重复评语。

**未取得三套模板逐项字段、尺寸、字体、官方色值和每套维度清单的可分发规格，因此这些 PDF 是合成兼容样例，不能证明官方导出模板 1:1，也不能据此冻结正式解析器的模板指纹。** 本夹具以需求 v1.2 中招聘评价的「专业能力、潜力、沟通协作、管理能力」构造公共演示行；每套真实维度名仍待合法规格核对。真实材料的解析验收必须另外取证。

页眉 Logo 从[七牛官网](https://www.qiniu.com/)的公开图片资源取得（原图 URL 见下），没有从人员材料中裁剪。只作演示材料页眉。

`https://www-static.qbox.me/_next/static/media/logo.0fc18feaa621d2068a7180631f742256.jpg`

## 首批面评材料

| 文件                                   | 独立验收点                                                                                         |
| -------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `interview/campus.pdf`                 | 校招模板名；印象类评语；三维度选择 2 / 4 / 3；面试官任辞远（演示）                                 |
| `interview/hr.pdf`                     | HR 模板名；故意含虚构籍贯 / 学历属性的评语，用于演示过滤；3 / 2 / 4；苏晚（演示）；职级位于第 3 页 |
| `interview/professional.pdf`           | 专业面试官模板名；新撰写的具体行为评语；4 / 3 / 5；叶青（演示）                                    |
| `interview/unknown-template.pdf`       | 未知模板必须拒绝，不能按相近标题猜测                                                               |
| `interview/score-missing.pdf`          | 专业能力行没有选中项，须待核对                                                                     |
| `interview/score-multiple.pdf`         | 专业能力行选中 2 和 4，须待核对，不能取首项                                                        |
| `interview/unknown-interviewer.pdf`    | 唯一故意不在目录里的虚构面试官，须待核对、不入档                                                   |
| `interview/flat-scores.pdf`            | 同一演示节点的平分样本，标注样本不足，不产生反向证据                                               |
| `interview/professional-duplicate.pdf` | 与 professional 字节完全相同，第二次导入不新增评价                                                 |

三份正常表都有三行适用维度、面试评级和建议职级，每行恰好一个选中项。「管理能力」在非管理岗位明确不适用且不选分，不属于识别失败。原表选择是待人核对的招聘材料，不是 Niu-Talent 已确认维度分，不写入象限或能力结论。`manifest.json` 内保留合成规则版本和行为锚点；印象和属性评语不能支撑正式能力分。

`candidates.json` **另行验收**四行候选人：1 行 hired 导入，rejected / offer_pending / offer_declined 共 3 行跳过。其中 rejected 行即便目录中有人也不能导入。该清单不是面评分数的 Excel 入口。状态都是专为此夹具构造，不改变原型人员状态。

## 引用与预期

`manifest.json` 是夹具预期，不是生产接口或冻结合同。每个维度行、每个矢量圆和综合评价都有 PDF 区域引用。坐标为 **1 开始的页码，PDF point，左上原点，`[x0, y0, x1, y1]`**；转换至底部原点时用该页高度反转 y。文字层只有全部选项标签，不编码哪项被选中。不得用文字层的第一个数字替代矢量解析。概览页评语重复只用来检验去重，明细页才是原评价来源。

`directory.json` 是原型身份的最小子集；不能用本文件自行授予权限或替代正式人员目录。

## 重建与验证

静态 PDF 可直接由解析器读取，不要求项目安装 Python 依赖。生成和独立检查工具都限定在本夹具目录，不改根 package、锁文件或应用代码。

```sh
python3 -m venv /tmp/bow-896-venv
/tmp/bow-896-venv/bin/pip install -r tests/fixtures/bow-896/requirements.txt
/tmp/bow-896-venv/bin/python tests/fixtures/bow-896/generate.py --pdf-only
/tmp/bow-896-venv/bin/python tests/fixtures/bow-896/validate.py --pdf-only
pdftotext -layout tests/fixtures/bow-896/interview/hr.pdf -
pdfinfo tests/fixtures/bow-896/interview/hr.pdf
pdftoppm -f 2 -singlefile -scale-to 1300 -png tests/fixtures/bow-896/interview/hr.pdf /tmp/bow-896-hr
```

生成器默认使用本机 `Arial Unicode.ttf`，可用 `--font <可用中文 TrueType 字体路径>` 覆盖；PDF 内嵌子集字体，阅读无需该本机字体。`invariant=1` 固定 PDF 元数据日期；相同输入下可重建。生成工具只辅助准备夹具，不属于应用生产逻辑，应用 85% 覆盖率口径不因本目录变化。

`validate.py` 从落盘 PDF 独立读取文本、元数据和绘图操作，核对圆的区域与填色，并检查异常、目录映射、候选人门槛、重复字节和资产摘要。它验证夹具本身，**没有运行正式解析器、导入器或真实供应商调用**。页面渲染仍需实看，不能用文字层检查替代。
