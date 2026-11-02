# BOW-906 演示面评导入

把 `tests/fixtures/bow-896/interview/` 里的三份合成 PDF 经隔离解析写成一份面评导入批次，供 HR 在 `/import?id=demo-interview-import-1` 逐行确认是谁。全部是化名演示数据，原件、片段、批次和招聘记录都标「演示」。

## 命令

```sh
pnpm exec tsx src/server/db/seed/interview-import-demo/run.ts --apply
```

只拒绝 `APP_ENV=production`；不加入 `db:seed`，也还没有接进部署脚本的 seed 步骤。成功只输出回执 `{status, batchId, rows}`，失败只输出错误分类，不打印 SQL 原错、连接串或原文。

## 写入内容

一笔事务：面试节点 `demo-interview-hiring` 和它的主体 `p-x08`，每份 PDF 的原件、版本、解析作业、解析版本、`historical_evaluation` 片段（只存页码和文字区间），批次，896 的四条演示招聘记录（职位号、面试时间为空），每条评价一行。

夹具从发布树读取，按代码里的固定 SHA-256 校验（来自提交 ef4c37b0），不读 Git 历史。

重放只比对 seed 自己写的列；行的修订、HR 的确认和导入决策归 HR，重放不比对也不覆盖。相同事实重放返回 `unchanged`，同一 ID 的事实不同即整笔回滚。

## 有意不写的夹具

- `hr.pdf`：评语里故意有虚构籍贯、学历标签，要等评语过滤上线；
- `professional-duplicate.pdf`：判重要有已入档的导入；
- `score-missing` / `score-multiple` / `flat-scores`：要 HR 补录，补录还没接通；
- `unknown-template`：解析器拒收；
- 淘汰、待入职、放弃录用的三条招聘记录没有 PDF，所以演示数据上不会触发三项自动跳过（只有单元测试覆盖）。

## 验证

`src/app/(desk)/import/import.integration.test.ts` 用真实命令首导和重放，再从 `/import` 页面确认一行，核对存下的导入决策。
