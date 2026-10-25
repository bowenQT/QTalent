# 部署材料（本卡不执行部署）

同一代码分别起 Web、worker；仅监听 `127.0.0.1`。样例 systemd 单元需由运维按实际 Node / pnpm 路径调整，不能直接在已有生产机器运行。本卡不会设置云资源、网络规则、Access、凭据或 Supabase。

## 环境变量

| 名称               | 用途                                                             | 必填          |
| ------------------ | ---------------------------------------------------------------- | ------------- |
| APP_ENV            | `local` / `test` / `demo` / `production`，演示时钟和安全环境边界 | 是            |
| NODE_ENV           | Next 运行模式，正式构建使用 production                           | 是            |
| DATABASE_URL       | PostgreSQL 连接；本地/测试必须独立数据库，演示按运维配置         | 是            |
| TEST_DATABASE_URL  | 仅集成/e2e/视觉测试，必须 loopback 且数据库名以 `_test` 结尾     | 仅测试        |
| BETTER_AUTH_URL    | 应用完整 origin，限制登录与 WebSocket Origin                     | 是            |
| BETTER_AUTH_SECRET | 至少 32 字符；从受控环境提供                                     | 是            |
| DEMO_PASSWORD      | 四个演示账号导入时使用，至少 12 字符；代码不设默认值             | 仅导入        |
| WORKER_PORT        | 本机 WebSocket 端口，默认 3001                                   | 否            |
| ACCESS_ENFORCED    | `true` / `false`；demo/production 必须 true                      | 是            |
| ACCESS_ISSUER      | `https://团队.cloudflareaccess.com`，不含路径                    | Access 开启时 |
| ACCESS_AUDIENCE    | Access application audience                                      | Access 开启时 |

MaaS、Jev、听悟、Kodo 当前只有接口、配置 schema 与显式 fake 工厂，未接真实客户端；本卡不配置其凭据或自动读取供应商环境变量。后续卡负责渠道、模型 ID、费用和凭据接入；配置 schema 的通过不等于真实服务验收。

## Access 与会话

Cloudflare 命名隧道把 `/stream` 发往 worker，其余发往 Next。Access 策略由管理员配置 `@qiniu.com`；应用每个 HTTP 请求和 WebSocket upgrade 都对 `Cf-Access-Jwt-Assertion` 作 RS256 真验签、issuer、audience、exp、iat、sub 校验，公钥来自固定团队域的 `/cdn-cgi/access/certs`，有缓存与超时。单纯邮箱 header 不构成身份。

应用会话与 Access 都使用真实安全时钟。只有业务有效期和列表日期使用演示时钟。local/test 可显式不启用 Access，demo/production 配置强制开启。生产不能访问 `/dev/design-system`。WebSocket 还要求同源 Origin 和有效 Better Auth 会话；本卡仅 heartbeat，不接音频，不开放录音权限旁路。

参考：[Cloudflare 应用令牌](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/)。

## 手工验收与恢复

部署前完成迁移备份/恢复演练、真实 Access 伪造/过期令牌拒绝、源站公网拒绝、实际域名登录和 WebSocket 测试。systemd 启动不自动迁移、不导入、不部署。数据库变更在受控维护步骤显式运行；恢复应用采用上一版本代码，新增表保留，不自动删库。任何生产回滚/迁移由维护者单独确认。
