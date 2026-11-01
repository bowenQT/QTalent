# 需求卡后端（BOW-852）

需求生成通过 BOW-842 的 staffing_demand job，返回已授权 snapshot，不把排队冒充需求成功。MaaS 输出永远是 draft；编辑与确认追加版本，旧确认不重写。原项目创建动作保持唯一入口。

权限要求当前有效 manager/hr grant，并满足发起人、管理者或相关 HR 范围；纯 owner/member/mentor/系统管理员没有需求访问权。每次读、修改、重放、job控制以及模型调用前/结果提交前重新验证。

## 接线边界

createStaffingDemandRuntime({db,boss,maas}) 显式组合已有数据库、已启动pg-boss与MaaS客户端；构造无网络调用。register() 只在worker显式调用，policy须加入既有jobs runtime。共享入口由协调单写，当前worker显式注册本runtime；源码接线不冒称演示环境已部署。本目录不读取环境变量或生成凭据。

## 重试与故障

只有已知 retryable 的失败允许授权用户通过共享job command显式retry；同operation重放不重复enqueue。outcome_unknown/未知异常不自动重试；取消与旧attempt fence阻止晚到结果写库。
running重投只忽略，不发送第二次模型调用、不破坏仍在运行的首调用。若进程在发送后退出，无法仅凭running区分丢响应与仍在运行；当前授权用户可用共享cancel安全终结该任务后另发新需求。未实现供应商结果查询或自动付费重试，不能把无结果当作成功。

## 验证

固定样例在prompt.ts，单测使用严格fake。真实隔离PostgreSQL覆盖生成/编辑/确认/历史、并发幂等、冲突、原子回滚、撤权、显式retry、cancel与重复delivery。正式迁移由X1在899/922已合后，从当前schema原生生成0007_bow_852_staffing_demands.sql；仅三张需求表，生成SQL未手改，已发布0000–0006与快照/journal历史保留。旧未发布0003候选和PR专用临时CI/脚本/目录覆盖已退役；默认测试固定使用提交迁移目录。空库、已有完整seed升级、冲突DDL+journal回滚与重放由本卡迁移回归验证。

2026-11-01已执行一次固定合成样例的真实Modelink/Gemini需求生成：实际受信环境工厂、当前数据库授权、原生队列及业务prompt/严格schema串联，HTTP200、attempts1，只保存draft revision1，必须/加分各一条，无人工确认或评分/排名。非敏感请求标识/耗时/usage及清理证据见[BOW-852单次真实验收](https://github.com/bowenQT/QTalent/issues/44#issuecomment-6556038429)；本轮预算已消耗，不重复付费请求。模型前后撤权、retry/cancel与重复delivery仍单独由真实PG+协议fake回归验证，未冒称进行了真实供应商撤权实验。
