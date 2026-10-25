# 需求卡后端（BOW-852）

需求生成通过 BOW-842 的 staffing_demand job，返回已授权 snapshot，不把排队冒充需求成功。MaaS 输出永远是 draft；编辑与确认追加版本，旧确认不重写。原项目创建动作保持唯一入口。

权限要求当前有效 manager/hr grant，并满足发起人、管理者或相关 HR 范围；纯 owner/member/mentor/系统管理员没有需求访问权。每次读、修改、重放、job控制以及模型调用前/结果提交前重新验证。

## 接线边界
createStaffingDemandRuntime({db,boss,maas}) 显式组合已有数据库、已启动pg-boss与MaaS客户端；构造无网络调用。register() 只在worker显式调用，policy须加入既有jobs runtime。共享入口由协调单写；尚未注册前不能称生产已接入。本目录不读取环境变量或生成凭据。

## 重试与故障
只有已知 retryable 的失败允许授权用户通过共享job command显式retry；同operation重放不重复enqueue。outcome_unknown/未知异常不自动重试；取消与旧attempt fence阻止晚到结果写库。
running重投只忽略，不发送第二次模型调用、不破坏仍在运行的首调用。若进程在发送后退出，无法仅凭running区分丢响应与仍在运行；当前授权用户可用共享cancel安全终结该任务后另发新需求。未实现供应商结果查询或自动付费重试，不能把无结果当作成功。

## 验证
固定样例在prompt.ts，单测使用严格fake。真实隔离PostgreSQL覆盖生成/编辑/确认/历史、并发幂等、冲突、原子回滚、撤权、显式retry、cancel与重复delivery。迁移由协调按83→94→本卡串行生成，未手工写SQL。一次真实模型运行仍待单独授权执行与记录；离线CI不替代该完成条件。
