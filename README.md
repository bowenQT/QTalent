# Niu-Talent

七牛云内部的人才识别、追踪与盘点工作台。AI 提供可追溯的建议，正式结论由有权限的人确认。

设计系统已定稿，高保真可交互原型正在评审，目标是完成 UI/UX 定稿。原型是独立 HTML、CSS 和 JavaScript，AI 行为用预置结果按真实节奏流式输出；正式应用、后端与 CI 尚未建立。

## 原型

原型有两条平行的方向，都分桌面版和手机版，各自带一份设计系统：

| 版本 | 位置 | 内容 |
| --- | --- | --- |
| 版本 X | `prototype/app/`、`prototype/m/` | 按需求定稿 v1.6 实现：CEO、HRBP、部门负责人、导师、员工五种视角，Landing 第三期等演示数据 |
| 版本 Y | `prototype/y/` | 中性工作台：管理者、HR、导师三种角色，人员是 XEngineer 第六期的演示数据；手机版只给导师用。管理者是公司层视角，看人、找人，确认规则与方案；整理档案和校准由 HR 做 |

演示人员都是化名并标「演示」。顶栏的视角切换只是演示手段，不是权限实现。

### 本地查看

在仓库根目录运行：

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory prototype
```

然后访问 `http://127.0.0.1:4173/`，这是评审导览页，列出走查路线和两个版本的入口。常用页面：

| 页面 | 地址 |
| --- | --- |
| 版本 X 工作台 / 手机版 / 设计系统 | `/app/index.html`、`/m/index.html`、`/design-system.html` |
| 版本 Y 工作台（按角色） | `/y/app/index.html?as=ceo`、`?as=hrbp`、`?as=mentor` |
| 版本 Y 导师手机版 / 设计系统 | `/y/m/index.html`、`/y/design-system.html` |

无需安装前端依赖或执行构建。演示操作只存在浏览器本地，可以在导览页或「更多 → 重置演示数据」清空。

### 评审站

[评审站](review-site/README.md)把 `prototype/` 原样发布给 `@qiniu.com` 邮箱登录查看，并在每页挂上划线评论。线上地址：<https://qtalent-review.aidoudoulong123.workers.dev/>（版本 Y 从导览页右栏进入）。它只服务原型评审，不代表正式工程的架构选型。

## 文档入口

- [最新需求基线：需求定稿 v1.6](docs/requirements/需求定稿-v1.6.md)，未提及的部分沿用前序版本，权威顺序见 AGENTS.md
- [Agent 共同入口与阶段约束](AGENTS.md)
- [工程、UI 与验证规范](docs/engineering.md)
- [界面文案规范](docs/ui-copy.md)
- [Issue、Proposal、Commit 与 PR 协作规范](CONTRIBUTING.md)

## 仓库与本地资料

远端为私有仓库 [bowenQT/QTalent](https://github.com/bowenQT/QTalent)，默认分支 `main`；后续改动通过任务分支和 PR 协作。实际设置与平台限制见 [远端配置与复核](CONTRIBUTING.md#远端配置与复核)。

`docs/sources/` 原始材料和 `docs/design-refs/` 设计参考资料仅在本地保留，已忽略，不随 clone 分发。文档中的来源路径仅用于回查；这些资料不影响已提交原型和设计系统的加载。

首次推送保留了 8 条既有提交的顺序、作者、时间与说明，并在推送前从全部历史移除了设计参考截图，因此提交哈希与建仓前不同。原始历史已在仓库外本地备份；后续以远端 `main` 为准，不合并或推送包含旧参考资料的历史分支。
