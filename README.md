# Niu-Talent

七牛云内部的人才识别、追踪与盘点工作台。AI 提供可追溯的建议，正式结论由有权限的人确认。

设计系统已定稿，下一步制作高保真可交互原型并完成 UI/UX 定稿。当前使用独立 HTML、CSS 和 JavaScript；正式应用、后端、CI 与线上站点尚未建立。

## 本地查看设计系统

直接用浏览器打开 [prototype/design-system.html](prototype/design-system.html)，或在仓库根目录运行：

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory prototype
```

然后访问 `http://127.0.0.1:4173/design-system.html`。无需安装前端依赖或执行构建。

## 文档入口

- [最新需求基线](docs/requirements/需求定稿-v1.2.md)
- [Agent 共同入口与阶段约束](AGENTS.md)
- [工程、UI 与验证规范](docs/engineering.md)
- [Issue、Proposal、Commit 与 PR 协作规范](CONTRIBUTING.md)

## 仓库与本地资料

远端为私有仓库 [bowenQT/QTalent](https://github.com/bowenQT/QTalent)，默认分支 `main`；后续改动通过任务分支和 PR 协作。实际设置与平台限制见 [远端配置与复核](CONTRIBUTING.md#远端配置与复核)。

`docs/sources/` 原始材料和 `docs/design-refs/` 设计参考资料仅在本地保留，已忽略，不随 clone 分发。文档中的来源路径仅用于回查；这些资料不影响已提交设计系统的加载。

首次推送保留了 8 条既有提交的顺序、作者、时间与说明，并在推送前从全部历史移除了设计参考截图，因此提交哈希与建仓前不同。原始历史已在仓库外本地备份；后续以远端 `main` 为准，不合并或推送包含旧参考资料的历史分支。
