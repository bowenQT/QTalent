# 演示环境准备（BOW-833）

执行范围以 [BOW-833](https://linear.app/bowenzhong/issue/BOW-833)、[已确认 spec](https://linear.app/bowenzhong/document/40677dca1a6b) 和 [协调索引 #248](https://github.com/bowenQT/QTalent/issues/248) 为准。记录写在 [GitHub #25](https://github.com/bowenQT/QTalent/issues/25)，本目录不维护另一份任务状态。

## 当前可用材料与门禁

本目录提供双进程 systemd 样例、命名隧道路由样例、只读仓库检查和下面的环境/验收手册。样例需要按部署机的 Node/pnpm 路径、域名与隧道标识填写，不能直接启用。

- 仓库内准备可以先做；首次部署等 BOW-897、BOW-899 合入 main。
- X1 维护最终迁移、共享配置和 worker 注册。当前 main 的 worker 只注册示例任务；BOW-842 接入业务任务后，才能完成队列消费的部署验收。
- 每次只部署所有者指定并确认的、已经合入 main 的完整 SHA。开通资源和实际执行部署须先得到所有者对具体方案的确认。
- 首次部署可只含已合入功能；本卡关闭还要求三幕在部署环境走通、每次部署有完整记录。
- 本轮材料不代表已经开通资源、部署、配置凭据或完成真实环境验收。

已确认但尚未实现的自动化仍为：`bootstrap.sh`、`deploy.sh`（含 backup/migrate/seed/回滚）、`verify.sh`、`latency.sh` 和三版本/七天备份保留策略。不要把下文顺序说明当作这些脚本已经存在，也不要直接拼装命令对真实环境执行。

## 目标环境与进程

| 项目   | 已确认选择                                                   | 执行前需确认                                      |
| ------ | ------------------------------------------------------------ | ------------------------------------------------- |
| 主机   | DigitalOcean 新加坡 sgp1，Ubuntu 24.04 LTS，2 vCPU / 4 GB 起 | 所有者开通；SSH 目标、公钥与实际系统信息          |
| 数据库 | Supabase Pro，新加坡 ap-southeast-1                          | 所有者开通；项目与 Web/worker 各自的连接模式      |
| 域名   | 默认 niu-talent.aidoudoulong123.com                          | 实际主机名、Access 应用和隧道一致                 |
| Web    | Node.js 24 LTS、仓库锁定的 pnpm；127.0.0.1:3000              | `package.json` 的精确 pnpm 版本与部署机可执行路径 |
| worker | 同一发布 SHA，127.0.0.1:3001，常驻 systemd                   | 注册的真实任务、会话数据库连接和退出恢复          |
| 入口   | Cloudflare 命名隧道；精确 /stream 转 worker，其余转 Web      | 公网不开放 80/443/3000/3001，Access 仅 @qiniu.com |

目标目录为 `/opt/qtalent/releases/<sha>`，`/opt/qtalent/current` 指向当前版本。两个服务使用同一个 current。systemd 的启动入口不迁移数据库、不导入数据、不读取仓库里的环境文件。

本目录 systemd 样例已经表达 current 与分进程环境文件布局；安装、用户/目录创建、PATH 和权限设置仍须由后续装机步骤及所有者确认。没有在本轮修改真实机器配置。

## 环境变量与数据库连接

systemd 从部署机加载 `/etc/qtalent/common.env` 加 `web.env` 或 `worker.env`；这是进程环境注入，worker 不自行读取文件。文件内容由所有者在部署机维护，按 spec 使用 root:qtalent、0640；不复制到仓库、PR、工单或日志。

| 变量               | 放置位置                 | 用途/要求                                                               |
| ------------------ | ------------------------ | ----------------------------------------------------------------------- |
| APP_ENV            | common.env               | 演示使用 demo；业务时钟与安全环境边界                                   |
| NODE_ENV           | common.env               | 正式构建和运行使用 production                                           |
| BETTER_AUTH_URL    | common.env               | 实际 HTTPS 域名的完整 origin；与 WebSocket Origin 一致                  |
| BETTER_AUTH_SECRET | common.env               | 至少 32 字符，由部署机生成并保管                                        |
| ACCESS_ENFORCED    | common.env               | demo/production 必须 true                                               |
| ACCESS_ISSUER      | common.env               | 固定 HTTPS Cloudflare Access 团队域，不含路径                           |
| ACCESS_AUDIENCE    | common.env               | 对应 Access 应用的 audience                                             |
| DATABASE_URL       | web.env                  | Web 按已确认 spec 使用事务连接池，6543                                  |
| DATABASE_URL       | worker.env               | worker/pg-boss 用会话模式或可达的直连，5432；迁移/导入/备份也使用此模式 |
| WORKER_PORT        | worker.env               | 3001；与隧道和本机监听配置一致                                          |
| DEMO_PASSWORD      | 显式 seed 命令的进程环境 | 至少 12 字符；四个演示账号首次导入使用，代码无默认值                    |
| TEST_DATABASE_URL  | 本机测试进程环境         | 仅本机测试，loopback 且库名以 _test 结尾；不注入演示服务                |

两个进程仍各自只读取 `DATABASE_URL`，不新增第二个数据库变量名。部署记录只写脱敏主机类别、端口和连接模式，不能输出完整连接串。

Supabase [当前连接说明](https://supabase.com/docs/guides/database/connecting-to-postgres)区分会话池 5432 与事务池 6543；事务池不支持 prepared statements，直连端点还需核对部署机的 IPv6 可达性。保持已确认的进程分工；部署前核对 Drizzle/Better Auth/node-postgres 实际没有使用命名 prepared statement。TLS 按 spec 开启并验证证书；这两项均需要真实环境证据，配置字符串存在不等于验收通过。

### 供应商与入口接线

当前 main 已有 MaaS、Jev、Kodo、听悟真实协议适配器；工厂存在不代表 worker 已选择真实实现，也不代表已有一次真实调用结果。具体边界以各适配器 README 为准：

- [MaaS](../src/server/integrations/maas/README.md)：服务端组合入口显式注入配置；渠道/模型以 BOW-843 当前执行入口和最终合入实现为准。
- [Jev](../src/server/integrations/jev/README.md)：已存在 `QINIU_MAAS_API_KEY`、`QINIU_JEV_BASE_URL`、`QINIU_JEV_MODEL`，实际值只在运行环境；Jev 的 confidence 不进入前端。
- [Kodo](../src/server/integrations/kodo/README.md)、[听悟离线](../src/server/integrations/tingwu/offline/README.md)：当前适配器以显式配置组合，环境命名/全局入口尚待对应卡与 X1 接线，本卡不猜测新变量。
- 演示机器人“小犇”的 `WECOM_BOT_ID`、`WECOM_BOT_SECRET` 只放部署机。测试机器人凭据与长连接不用于部署准备；BOW-895/909 的测试连接仍按本机资源锁规则执行。
- MCP/AgentAPI 的开关、身份与配置来自对应入口卡和 X1 的最终接线；不使用虚构变量表示“已接通”。BOW-916 展示状态，不替代真实调用证据。

## 仓库部署前检查

先在准备环境显式更新 origin/main，再在独立、干净的候选 checkout 检出所有者指定的完整 SHA。下面的检查不拉代码、不读环境文件、不联网、不迁移、不启动服务，也不授权部署：

```sh
node deploy/preflight.mjs <40位完整SHA>
```

它核对：当前 HEAD 等于指定 SHA、该 SHA 属于本地已知 origin/main、工作区干净、Node 24、精确 pnpm 版本与受版本控制的锁文件。输出只有 SHA、固定检查名称和布尔结果，不输出 Git 路径列表、环境变量或原始子进程错误。退出 0 仅表示上述仓库检查通过；本地 origin/main 的新鲜度、897/899 合入、当前 head 的交叉审查/CI、资源授权和真实运行状态仍要单独核对。

离线回归：

```sh
node --test --test-concurrency=2 deploy/preflight.test.mjs
```

本机运行完整 `pnpm check`、`test:integration`、`test:e2e`、`test:visual` 前，先按派发文档原子取得 `resource-heavy-1` 或 `resource-heavy-2`，结束按自己的 token 释放。Vitest 单测使用 `--maxWorkers=2`，开发服务用完停止。

在部署机已由所有者注入进程环境后，可用正式 schema 作只读变量形状核对。只输出字段名，不输出变量值；该步骤不会建立数据库连接或调用供应商：

```sh
node --import tsx --input-type=module <<'JS'
import { parseEnv } from './src/server/env.ts';
try {
  parseEnv(process.env);
  console.log(JSON.stringify({ valid: true }));
} catch (error) {
  console.log(JSON.stringify({
    valid: false,
    fields: error.issues?.map((issue) => issue.path.join('.')) ?? [],
  }));
  process.exitCode = 1;
}
JS
```

变量形状通过仍不能证明数据库模式、证书、Access 策略或供应商已经可用。

## 实际部署顺序与恢复边界

实际执行前在 #25 写明拟部署完整 SHA、前置卡合入、当前 head 的审查/CI、目标机器/域名/数据库类别、计划迁移、备份、回滚路径和待所有者确认的操作。得到本次范围的确认后执行，不因“准备材料已合入”自动部署。

1. 所有者在控制台开通/确认主机、Supabase 项目、Access 应用和命名隧道；授权 SSH 与只读 deploy key。
2. 装机并核对只监听 loopback、双进程环境、工具链路径。先建立 backups 与 releases 的恢复路径，完成备份恢复演练。
3. 拉取已合入的指定 SHA，运行仓库检查，锁定安装并构建。用 worker 的会话/直连模式显式备份；需要时再显式迁移、导入化名演示数据。
4. Web 与 worker 一起切到同一个 SHA 并重启；本机无 Access 令牌访问 /login 应得到 401。worker 检查进程和 loopback 监听；不把任意 404 当作认证验证。
5. 通过实际域名作下表的运行验收，记录两个进程各自的实际发布路径/提交、迁移状态和任务消费结果。
6. 失败时先如实记录结果及未知边界，再按已确认的上一发布 SHA 回切两个进程。代码回切不会恢复数据库；迁移是否向后兼容、是否需要单独恢复数据库必须明确。不得自动删表、回写历史或重置数据。

## Access、原件与业务验收

应用每个 HTTP 请求和 WebSocket upgrade 验证 Access 的签名、issuer、audience、有效期与身份；WebSocket 另需同源 Origin 和有效 Better Auth 会话。安全令牌/会话用真实时钟，业务演示日期不用于验签。

| 检查       | 应保留的证据与结果                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 源站       | 从机器外直连 80/443/3000/3001 均被拒绝；经域名正常访问                                                                                |
| Access     | 未登录经域名进入 Access；机器内 HTTP 伪造/过期令牌返回 401                                                                            |
| WebSocket  | 先以精确 /stream、正确 Origin、有效 Access 与应用会话得到 101，再仅更换伪造/过期 Access 令牌得到 401；403/404 不算验签通过            |
| 登录与权限 | 实际演示账号经域名登录，管理者/HR/导师范围正确；管理员无人才数据；撤权后重新访问受限                                                  |
| 业务队列   | BOW-842 注册业务任务后的真实入队、消费、持久状态、失败与重启恢复；不是只看进程 active                                                 |
| 原件私有   | 匿名访问、无权限人员、过期签名拒绝；授权人员按来源版本回到原件。记录引用/对象的脱敏标识，不贴签名 URL                                 |
| 重启与回滚 | 实际重启后 Web/worker 同 SHA、任务恢复；上一发布可回切，数据库恢复步骤经过演练                                                        |
| 三幕       | 按 BOW-871/872 在部署环境走通；未接真实链路的页面按实际状态说明                                                                       |
| 供应商     | 新加坡到听悟/MaaS/Kodo 接入点的 TCP/TLS 各20次及中位数/P95；真实请求另记接口/模型、脱敏 request/task ID 与成功/失败，不以探活代替调用 |

实时推流已移到赛后，本次不将 40 分钟实时推流作为部署关闭条件。供应商接入点从对应卡最终 spec/实现读取，不在部署脚本里猜测。

## 每次部署记录模板（写到 #25）

```text
部署记录
目标与所有者确认链接：
部署 SHA / 上一 SHA：
897、899 合入证据；业务 worker / 三幕前置：
受检 head 的交叉审查、CI：
迁移：当前已应用版本、计划/实际结果；备份与恢复演练：
Web 实际运行 SHA / 发布路径：
worker 实际运行 SHA / 发布路径 / 已注册业务任务：
Web / worker 数据库连接模式与脱敏主机类别、端口：
Access / 登录 / HTTP 与 WebSocket 正负例：
原件授权 / 匿名、越权和过期拒绝：
队列消费 / 重启恢复：
三幕 / 桌面与手机实走结果：
供应商连通测量与真实调用证据：
失败项、未知结果与后续责任：
回滚步骤及实际验证：
运行进程、占用资源和交接：
```

记录每项实际结果，未执行写“未执行”并说明解除条件。日志、截图、PR 和工单不含令牌、连接串、签名 URL 或真实员工材料。
