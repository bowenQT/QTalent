# BOW-846 提前纯用例：逐草稿确认、改分和撤销

这五个新文件是执行入口允许的纯规则/假数据用例阶段。不是旧PR162的继续，也不是完整保存服务。起点main91b297afbc005a26a0f9bd93a2126fbd1d2fe6c9，显式依赖基线502bf97051d04c2eba7ba1ffd1112438db1edfa5：899 d5cf82fa的授权源码与冻结96fa3aa相同，含897冻结0b20a913及X1最小fixture。上游文件只消费、不修改。净差按上述基线之后的五文件审；最终仍等上游真合main。

## 实际行为

- 输入沿844的recordSaveInput/recordUndoInput，可信草稿使用897 RecordBatchDraftSet。按稳定draftId定位；两件事即使同一人也保留不同ID，不按人员自动合并。检查当前revision、全部人员、服务器已选项目及未决去重，不产生另一套前端契约。
- 直接用899 canConfirmOwnNodeScore判当前人/节点/有效关系。管理者有有效评价关系可确认本人评分；全公司读取或manager字符串不额外授予写权。系统管理员、跨节点、到期和noReview拒绝。实际来源逐一验证完整引用/定位/版本与全部共同主体，调用899 canReadNodeTalent核kind及requiredKinds。没有legacy权限回退。
- readRules只接草稿保存的dimensionVersionId/anchorVersionId，不查询当前发布版。引用保留原件与片段身份，原AI建议与人的新值均核对冻结锚点，逐字引用必须存在于权威版本片段；锚点须来自冻结版本且唯一；发布v2后确认v1草稿仍用v1。来源事实和项目选择必须由权威loader给出，不接受客户端自报完整或允许。
- confirm/edit是对尚未确认的建议形成本人首次人工确认；edit保留人写的SBI/分数/理由。已存在本人同事件/维度有效确认时，新operation仍冲突；本片没有另加修订已确认分的入口，不覆盖人工历史。unknown始终为null，不当作零分。
- 分差直接沿844 reviewActiveItemSchema：绝对差至少2。改AI建议且没写理由产生ai_gap；另一评价人的有效同事件/维度确认差至少2产生rater_gap，理由不豁免；未知与已撤回确认不参与。计划只追加新确认/复核，不把AI建议原稿改成人工事实。
- 按actor/action/operation语义重放保留原回执与原草稿来源，仍核当前权限。不同载荷、旧revision、同一业务确认冲突。people/decisions顺序不改变语义指纹。
- 五秒撤销按真实服务端墙钟的半开窗：4999ms允许，5000ms拒绝。只能本人；他人在本次新建事件上后续确认、HR已处理相关复核、原确认已失效等均整批冲突。第二评价人撤销只撤本人确认和本次复核，不撤原事件；原话保留精确空白，不通过旧RecordInput的trim转换重建；引用及原件历史保留。旧契约在未来公开边界的trim问题仍需X1统一处理，本片没有修改契约。

## 异步用例与交付边界

createConfirmRecordDraftUsecase必需显式注入当前授权、状态、冻结规则、完整来源、业务/真实时钟和ID分配。等待来源期间撤权曾返回planned；修复为最后重新加载状态与当前授权、核账号人员绑定、业务时间和草稿语义，再同步形成计划。失败明确返回forbidden/conflict/unavailable；冲突保留输入，未知依赖异常继续抛出，不造空成功。

返回值是内部`status: planned`和拟提交效果，不是保存成功，不修改输入、不调用数据库或队列。计划中的receipt/confirmedAt是拟提交值；后续原生事务必须在真正提交时重新核时钟、权限和全部版本栅栏。纯测试不是三层幂等的数据库并发、跨进程锁/回滚或重启证据；本轮未建立生产adapter/actions，也没有新增默认内存存储。

## 后续真实主链窗口

1. **852真合main后**按卡入口从当时main新开正式分支，只搬846实际逻辑与测试，替代旧162并记录去向。本片不关旧PR、不夹带其旧852/837/0003/0004。最终迁移只由X1排在852之后生成。
2. 845拥有AI整理/稳定草稿与来源；846后续在同一原生Read Committed事务内锁后重载授权，接899待确认事项归属/完成，核operation/CAS/业务唯一键并原子写事件、确认分、复核、审计与回执。完整证据加载、当前项目选择、事件映射及原确认/复核状态需来自真实存储；不能拿本片结构当已有表或既有端口。
3. 873仍拥有上传集合/成员及归档对象；846后续补保存ledger的当前集合许可、event→canonical集合、外部成员数，并与873同quota锁。**说话人绑定revision归860**，本片没有该值，也不拿draft/upload/collection revision替代。859归档getter不是永久处理许可。
4. 902的readScoreConfirmations仍需846真实同节点/人员的确认快照与修订栅栏；本片的规划数组不产生ready/pending/unavailable权威状态，不从active分数或任务状态猜齐备。节点结论/其持久化不在846。
5. 837/X1负责公共来源投影、person及共享注册；本片没有改公共出口、actions、schema/SQL、uploads或worker。904被拒的独立观察持久化不迁入本卡。真实PG入口、最终迁移及所有实际blocked-by条件未满足前保持Draft/Part of BOW-846。

精确命令、受检SHA、覆盖率和CI以PR交接为准；只使用化名夹具，没有供应商或凭证调用。
