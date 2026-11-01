# 演示环境准备（BOW-833）

执行范围以 [BOW-833](https://linear.app/bowenzhong/issue/BOW-833)、[已确认 spec](https://linear.app/bowenzhong/document/40677dca1a6b) 和 [协调索引 #248](https://github.com/bowenQT/QTalent/issues/248) 为准。记录写在 [GitHub #25](https://github.com/bowenQT/QTalent/issues/25)，本目录不维护另一份任务状态。

## 当前可用材料与门禁

本目录提供双进程 systemd 样例、命名隧道路由样例、只读仓库检查和下面的环境/验收手册。样例需要按部署机的 Node/pnpm 路径、域名与隧道标识填写，不能直接启用。

- 11/1 所有者已批准现在搭建，不等 BOW-897、BOW-899；每次部署前重新核对完整 SHA 已属于最新 main，只部署该 SHA 已有的功能、正式迁移与化名 seed。
- X1 维护最终迁移、共享配置和 worker 注册。当前 main 的 worker 只注册示例任务；BOW-842 接入业务任务后，才能完成队列消费的部署验收。
- 已批准的资源范围：DO 新加坡 2 vCPU / 4 GB 一台（约 USD24/月）、Supabase 新加坡免费项目一个、CF 命名隧道和 Access 应用各一个。域名固定 hr.aidoudoulong.com，不购买域名或改其他子域；额外付费需另决。新凭证、持续访问及安全配置的执行按根编排汇总的当次确认处理，不能由资源费用批准代替。目标身份与入口、实际操作仍写 #25。
- 首次部署可只含已合入功能；本卡关闭还要求三幕在部署环境走通、每次部署有完整记录。
- 本轮材料不代表已经开通资源、部署、配置凭据或完成真实环境验收。

已提供 host-local 的 prepare/deploy/backup/migrate/seed/应用回滚/status 与受管保留策略。装机 bootstrap、完整 Access/原件自动验收、供应商延迟脚本及数据库恢复演练仍未交付；不会安装或改动未确认环境。

## 目标环境与进程

| 项目   | 已确认选择                                                   | 执行前需确认                                        |
| ------ | ------------------------------------------------------------ | --------------------------------------------------- |
| 主机   | DigitalOcean 新加坡 sgp1，Ubuntu 24.04 LTS，2 vCPU / 4 GB 起 | 所有者开通；SSH 目标、公钥与实际系统信息            |
| 数据库 | Supabase Free，新加坡 ap-southeast-1                         | 独立 Free 组织及实际全账号免费配额；不追加 Pro 收费 |
| 域名   | hr.aidoudoulong.com                                          | 只改该子域，实际 Access 应用与单隧道一致            |
| Web    | Node.js 24 LTS、仓库锁定的 pnpm；127.0.0.1:3000              | `package.json` 的精确 pnpm 版本与部署机可执行路径   |
| worker | 同一发布 SHA，127.0.0.1:3001，常驻 systemd                   | 注册的真实任务、会话数据库连接和退出恢复            |
| 入口   | Cloudflare 命名隧道；精确 /stream 转 worker，其余转 Web      | 公网不开放 80/443/3000/3001，Access 仅 @qiniu.com   |

目标目录为 `/opt/qtalent/releases/<sha>`，`/opt/qtalent/current` 指向当前版本。两个服务使用同一个 current。systemd 的启动入口不迁移数据库、不导入数据、不读取仓库里的环境文件。

本目录 systemd 样例已经表达 current 与分进程环境文件布局；安装、用户/目录创建、PATH 和权限设置仍须由后续装机步骤及所有者确认。没有在本轮修改真实机器配置。

## 环境变量与数据库连接

systemd 从部署机加载 `/etc/qtalent/common.env` 加 `web.env` 或 `worker.env`；这是进程环境注入，worker 不自行读取文件。文件内容只由获准的部署流程写入，权限 0600；供辅助命令以 qtalent 身份读取的文件由 qtalent 持有，systemd 只负责注入进程。实际主机的目录/属主/持续访问配置先按当次确认落地；不复制到仓库、PR、工单或日志。本机只 source ~/.config/niu-talent/deploy.env 与必要的 vendors.env，不搜索其他秘密路径。

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

## 新资源与凭证边界

现有 Supabase Pro 组织中的新项目不能当作免费项目；先核 Free 组织与全账号配额，不为腾位删除/暂停/升级旧项目。只使用 PostgreSQL 的本应用不需要 Supabase Data API，新项目默认的 Data API / 自动暴露新表需按确认关闭，不能把普通 public 表的默认暴露当作服务端授权。

DO 操作只用已安装的 DigitalOcean app；镜像是 Ubuntu LTS，不能改用 Codex 开发机镜像。Cloudflare 复用 odd-heart-bd91，OTP Allow 仅 @qiniu.com，无 bypass；新隧道仅需自己的 connector 凭据，不为变量名齐全新建全账号 API token。需要本人登录、接受新条款或绑支付时，记录精确入口后交回根编排处理。

SSH/DB/应用 secret 与四个预置演示账号密码在本次明确确认后生成；DEMO_PASSWORD 仅本机 deploy.env（0600）及获准演示机环境文件中保存，给所有者本机查看方法，不贴值。只把当前运行实际需要的 vendor 项从 vendors.env 注入该机 0600 文件；不上传测试库连接或无关变量。密钥和真实输出不进入仓库/工单/日志。

## 仓库部署前检查

先在准备环境显式更新 origin/main，再在独立、干净的候选 checkout 检出已合入且符合本次部署前置的完整 SHA。下面的检查不拉代码、不读环境文件、不联网、不迁移、不启动服务，也不授权部署：

```sh
node deploy/preflight.mjs <40位完整SHA>
```

它核对：当前 HEAD 等于指定 SHA、该 SHA 属于本地已知 origin/main、工作区干净、Node 24、精确 pnpm 版本与受版本控制的锁文件。输出只有 SHA、固定检查名称和布尔结果，不输出 Git 路径列表、环境变量或原始子进程错误。退出 0 仅表示上述仓库检查通过；本地 origin/main 的新鲜度、配置的额外主线前置、当前 head 的交叉审查/CI、资源授权和真实运行状态仍要单独核对。

离线回归：

```sh
node --test --test-concurrency=2 deploy/preflight.test.mjs
```

本机运行完整 `pnpm check`、`test:integration`、`test:e2e`、`test:visual` 前，先按派发文档原子取得 `resource-heavy-1` 或 `resource-heavy-2`，结束按自己的 token 释放。Vitest 单测使用 `--maxWorkers=2`，开发服务用完停止。

发布准备使用 `pnpm install --frozen-lockfile --prod=false --ignore-scripts`，显式保留构建所需的 devDependencies；`tsx` 也属于这一完整安装，不能仅安装生产依赖后运行下面的检查。构建后创建 `.next/cache` 并确认属主为 qtalent，以满足 systemd 的 `ReadWritePaths`；本轮未安装或修改真实单元。

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

## 可执行部署与恢复入口

`deploy/deploy.sh` 在已经确认的 Linux 演示机本地运行，使用既有 `qtalent` 用户、两份 systemd 单元、Git repository、工具链和环境文件。它不创建用户、不安装/启用单元、不配置隧道或安全策略，也不 SSH 到某个猜测的目标。实际执行由具备既有部署权限的操作者完成；脚本没有自动 sudo 或权限扩展。

将 `target.example.json` 的**非敏感目标元数据**在部署机受控路径中填写：精确 hostname、环境确认记录、根目录/既有仓库、环境文件目录、备份目录、Node/pnpm/pg_dump 路径、Web/worker 的数据库主机/端口/库名，以及按本次部署计划明确指定的可选 897/899 合入 SHA。样例故意为 `confirmed:false` 且带占位符，不能直接执行。清单不含密码或连接串；`confirmationRef` 是由操作者核验过的 #25 环境记录引用，脚本只核其格式与机器/目录/环境事实，不冒充在线核实所有者身份的授权系统。

所有变更入口都必须显式给出 `--target` 和匹配的 `--target-id`。脚本核对当前机器身份、真实目录、demo/production Node 运行模式、Access 开启、origin、两种数据库连接身份与 TLS 模式；环境文件只在子进程中 source，不读取后打印或复制。未知目标、production 运行域、未合 main 的 SHA 和未满足的显式前置均失败。11/1 首发批准只要求已合 main，样例 prerequisites 明确为 {}；若后续计划在其中填写 bow897/bow899 的完整 SHA，它们仍必须是候选版本的祖先，不接受未知键或占位值。空前置不放过主线归属、目标身份或环境检查。

以下为操作顺序示意，`TARGET_FILE`、`TARGET_ID`、`SHA`、`PREVIOUS_SHA`、`BACKUP_FILE` 和 `SEED_BACKUP_FILE` 由 #25 已确认记录填写。不是当前机器的部署命令，本轮没有实际执行：

```sh
# 只准备指定 SHA：锁定安装、构建、写发布元数据，不切服务或迁移
deploy/deploy.sh prepare --target "$TARGET_FILE" --target-id "$TARGET_ID" --sha "$SHA"

# 显式备份，输出备份路径/摘要及操作记录标识；使用 worker 会话连接
deploy/deploy.sh backup --target "$TARGET_FILE" --target-id "$TARGET_ID"

# 只在计划需要时运行，每次都要单独新备份；一次备份不能重复授权另一数据库写入
deploy/deploy.sh migrate --target "$TARGET_FILE" --target-id "$TARGET_ID" --sha "$SHA" --backup "$BACKUP_FILE"
# seed 前再运行一次 backup，并将新输出路径记为 SEED_BACKUP_FILE
deploy/deploy.sh backup --target "$TARGET_FILE" --target-id "$TARGET_ID"
deploy/deploy.sh seed --target "$TARGET_FILE" --target-id "$TARGET_ID" --sha "$SHA" --backup "$SEED_BACKUP_FILE"

# 显式确认当前版本及数据库与应用回退兼容性，首次部署 expected-current 为 none
deploy/deploy.sh "$SHA" --target "$TARGET_FILE" --target-id "$TARGET_ID" --expected-current "$PREVIOUS_SHA" --rollback-compatible

# 应用回切：复用已构建的受管版本，不迁移、seed、删表或自动恢复数据库
deploy/deploy.sh rollback --target "$TARGET_FILE" --target-id "$TARGET_ID" --sha "$PREVIOUS_SHA" --expected-current "$SHA" --rollback-compatible

deploy/deploy.sh status --target "$TARGET_FILE" --target-id "$TARGET_ID"
```

`--rollback-compatible` 表示操作者已依据 X1 的迁移与恢复证据核对代码/数据库兼容性，它不是脚本自动推导出的保证。没有这项前提不切版本；单纯代码回退不等于数据库恢复。

### 实际执行与记录语义

- 发布从既有 repository 显式 fetch main，验证目标属于最新主线，并逐项验证清单中显式设置的前置是目标 SHA 的祖先。Git archive 导出到独立暂存目录，以 qtalent 用户锁定安装/构建。完整构建后才变为 `releases/<sha>`，存在不相容同名目录时拒绝覆盖。
- 读取 worker 数据库的 Drizzle 迁移日志（只读事务），按已安装 Drizzle 的 SQL SHA-256/时间戳合同，与发布内 journal 的完整前缀核对。迁移未应用、记录缺失或探测失败时不激活；不自动跑迁移。
- 切换 `current` 后重启两份既有单元，以最多30次、间隔1秒检查启动就绪（单次网络探测另有10秒上限）。自动存活检查要求 /login 无令牌返回401、worker端口可连，且两个 MainPID 的实际 /proc cwd 都对应所选发布 SHA。401/端口只能证明这层健康，完整 Access、原件授权和三幕验收仍按下表另做。
- 激活或健康失败时，恢复起始链接并重启两份服务，重新读取两个运行版本和健康状态；首次部署失败则撤掉 current、停两份服务并确认 PID 为0。恢复失败明确记为 `failed_rollback_failed`。显式应用回滚本身失败也会尝试恢复操作前的版本。
- 部署机 `.deployment-lock` 将准备、备份、数据库写入、部署/回滚串行化。崩溃后的锁不按时间自动回收；先核记录、锁内进程信息和实际服务，确认原操作已停止后再处理。这里的主机操作锁不同于本机 Git 领卡锁。
- 每个操作以独立 JSON 写入 `<root>/deployment-records/`；阶段和终态原子更新，记录目标/来源SHA、实际Web与worker版本、迁移哈希/时间、备份摘要、回滚结果和稳定错误码，不写环境值、命令输出或原始异常。CLI返回记录标识。记录目录不是新的任务看板，真实结果仍回填 #25。
- 备份的连接信息只进入 libpq 环境，不放命令参数；备份子进程使用私有 umask。备份摘要绑定目标数据库身份，迁移/seed 前核验且标记一次性消耗；数据库命令失败写 `outcome_unknown`，不盲目重试、自动回切数据库或声称已恢复。
- 清理只识别本工具的受管目录/备份元数据；保留最近3份已激活发布、7天备份，跳过外部目录、符号链接和不相容元数据。部署后的发布清理失败会返回维护警告，保留健康服务和失败记录，不伪称清理成功。

离线验证使用真实临时 Git、归档和文件系统；只控制 Linux 服务/构建/数据库 I/O。不会把这些结果当作真实 systemd、Supabase、TLS、Access 或三幕验收：

```sh
node --test --test-concurrency=2 --experimental-test-coverage '--test-coverage-include=deploy/*.mjs' '--test-coverage-exclude=deploy/*.test.mjs' --test-coverage-lines=85 --test-coverage-branches=85 deploy/*.test.mjs
```

## 实际部署顺序与恢复边界

实际执行前在 #25 写明拟部署完整 SHA、前置卡合入、当前 head 的审查/CI、已确认目标机器/域名/数据库类别、计划迁移、备份和回滚证据。符合已确认环境的范围授权即可串行部署；涉及新凭证/持续授权/安全配置时先核本次确认，环境身份或明确前置缺失时在 #248 记录并继续独立准备。

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

11/1 所有者要求录音 WebSocket 连续40分钟，须按实际结果保留成功、失败或未执行。当前主线 /stream 只有心跳并拒绝音频二进制，心跳连续40分钟也不能称录音通过；录音功能真合 main 后再验，不上线未合分支补能力。国内打开速度须用真实国内测点，不能用本机或新加坡测量冒充。供应商接入点从对应卡最终 spec/实现读取，不在部署脚本里猜测。

## 每次部署记录模板（写到 #25）

```text
部署记录
精确目标与既有环境确认记录：
部署 SHA / 上一 SHA：
已合 main 归属及本次显式前置；业务 worker / 三幕能力边界：
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
