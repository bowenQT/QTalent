# 评审站（review-site）

把 `prototype/` 原样发布成一个只对 `@qiniu.com` 开放的网站，并给每个页面挂上划线评论层。它只服务原型评审，不是正式工程的架构选型；原型本身仍是无构建的独立 HTML。

## 组成

| 部分 | 作用 |
| --- | --- |
| Cloudflare Worker（`worker/index.js`） | 每个请求先校验登录凭证；静态页面来自 `../prototype`，HTML 响应里注入 `/__review/review.css` 和 `/__review/review.js` |
| Cloudflare Access | 边缘登录：公司邮箱收一次性验证码。Worker 会再校验一次 JWT 的签名、受众、签发方、过期时间和邮箱域名，防止绕过 Access 直接访问 |
| D1（`migrations/`） | 存评论：一条讨论加若干回复；锚点是划线原文和前后文，或元素路径；`context` 记下评论时的演示视角和页面状态 |
| 评论层（`worker/client/`） | 选中文字评论、点选元素评论、回复、标为已解决、只能删除自己的评论；锚点找不到时可以「还原现场」 |

页面通过 `window.NTReview = { context(), restore(ctx) }` 提供现场。原型在 `prototype/app/js/core.js` 里实现：`context()` 返回视角和页面自报的状态；`restore()` 先切到当时的视角，再交给页面还原。

`ACCESS_AUD` 为空时站点一律返回 403。演示数据只存在访问者自己的浏览器（`localStorage`），评论存在 D1，所有登录的评审者可见。

## 本地运行

需要 Node.js。在仓库根目录：

```bash
npx -y wrangler d1 migrations apply qtalent-review --local --config review-site/wrangler.jsonc
```

```bash
npx -y wrangler dev --config review-site/wrangler.jsonc --port 8799 --ip localhost
```

本地登录靠 `review-site/.dev.vars`（不进仓库）里的一行 `DEV_BYPASS_EMAIL=你的名字@qiniu.com`，只在 `localhost` 生效。打开 `http://localhost:8799/`。

### 评论提交回归检查

在仓库根目录运行 `python3 -m http.server 4182 --bind 127.0.0.1`，打开
`http://127.0.0.1:4182/review-site/tests/submit-regression.html`。
页面直接运行真实评论脚本，以内存 fixture 延迟或拒绝 POST，检查新评论与回复的重复快捷键、
面板重绘、失败保留输入及重试；两行均显示 `PASS` 即通过。不需要登录、依赖安装或真实 D1 数据。

对应的桌面和手机检查截图：[`submit-desktop.png`](tests/evidence/submit-desktop.png)、
[`submit-mobile.png`](tests/evidence/submit-mobile.png)。

## 首次部署

1. 登录 Cloudflare：`npx -y wrangler login`。
2. 建库，把输出里的 `database_id` 填进 `wrangler.jsonc`：

   ```bash
   npx -y wrangler d1 create qtalent-review
   ```

3. 建表：

   ```bash
   npx -y wrangler d1 migrations apply qtalent-review --remote --config review-site/wrangler.jsonc
   ```

4. 发布（此时 `ACCESS_AUD` 为空，站点先是 403）：

   ```bash
   npx -y wrangler deploy --config review-site/wrangler.jsonc
   ```

5. 在 Cloudflare Zero Trust（团队 `odd-heart-bd91`）为发布出来的 `qtalent-review.<子域>.workers.dev` 建一个 Self-hosted 应用：登录方式选 One-time PIN，策略为 Allow · Emails ending in `@qiniu.com`。
6. 把应用的 Application Audience (AUD) Tag 填进 `wrangler.jsonc` 的 `ACCESS_AUD`，再执行一次第 4 步。

之后改原型或评论层，只需要第 4 步。

## 读取评论

```bash
npx -y wrangler d1 execute qtalent-review --remote --config review-site/wrangler.jsonc --command "SELECT page, author, body, quote, context, resolved, created_at FROM comments WHERE parent_id IS NULL ORDER BY created_at DESC LIMIT 50"
```

本地库把 `--remote` 换成 `--local`。

## 不做的事

- 不存演示数据：每位评审者的操作只在自己的浏览器里，可以在导览页或「更多 → 重置演示数据」清空。
- 不接真实人员数据：原型里的人都是化名，`docs/sources/` 的内容不进这个站点。
- 密钥不进仓库：Worker 只需要上面的公开配置；`.dev.vars` 已被忽略。
