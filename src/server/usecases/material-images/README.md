# BOW-905：真实图片裁剪与外发门禁小片

## 范围与输入版本

基线 main `91b297afbc005a26a0f9bd93a2126fbd1d2fe6c9`。冻结897 `0b20a913621121848219e0966ba4bf4844d1bdb3` 的 MaterialSourceReference/MaterialImageRegion，899 `d5cf82fa264e022b8e4c928b008461e98c53293d` 的实际节点授权，843 `d688c92eed320102d099ecc1f4af74f50298f32e` 的实际 Modelink 协议与严格响应校验。Sharp 精确 `0.35.5`，X1选型及两包文件窗口见 #248/6548950329。

仅PNG、JPEG、WebP输入，按真实容器签名及解码格式核MIME；输出统一PNG。PNG是外发格式，不是限制只接PNG。五文件不包含图片上传lane、生产reader/存储/事务、worker、845恢复或公开HTTP。未知/名单外/整张只作附件/项目归属等未决动作未实现，不扩897契约。

## 实际裁剪

`cropMaterialImage`只变换字节，不授予访问许可。输入为已经绑定原件ID、原件版本、片段/原图区域及SHA256的内存字节。先核输入预算和摘要，复制缓冲避免跨await修改，再核容器和实际解码格式。PNG动画控制区块、WebP动画标志/ANIM/ANMF、重复图像块、JPEG多图/MPF或拼接尾随内容均拒绝，不静默取首帧。原件路径、任意URL及image/*通配输入不进入解码器。

897区域是**存储原图、裁剪前的归一化坐标**。`displayToStoredRegion`只按可信EXIF方向1～8反映射显示框；生产调用方须从已验证原件取得方向，不能相信请求自报方向。输入给裁剪器的source始终是存储坐标。按原始width/height执行左/上ceil、右/下floor；没有完整像素就拒绝。裁前不autoOrient、不resize；输出保持存储像素方向，EXIF被移除。UI框选/回看接线必须使用相同反映射，尚未在本片声称接通。

使用真实Sharp.extract，转sRGB、裁后白底消除透明RGB隐藏内容，再重编码PNG；不保留原EXIF/XMP/ICC、缩略图或原始文件缓冲。canonical source保持不变，`pixelRegion`和`actualRegion`另记实际向内取整后的子区域，不能伪造新持久片段。原图ID/version/hash、裁后hash及模型/提示版本随候选追溯；这些标识不交给模型。

## 完整来源与当前许可

`createImageDisclosureGate`必须显式提供clock、预算、真实Modelink接口、loadCurrent和有界readOriginal，没有fake生产默认。loadCurrent是未来**可信服务端适配器**：读当前batch/material/item与成员revision、不可变原件/source/hash/MIME/字节数、绑定同一原件版本及revision的已核范围和全部共有人，另读当前899节点事实与846独立处理写许可。不得把请求里的人员/角色/框、旧页面筛选列表或选定节点装成这些事实。

门禁核全体范围，不以裁剪逃过原图含越权或未知人员的约束。每位共有人都须属于当前批次成员和节点，对全部kind/requiredKinds同时满足source-read与model-input；performance材料即使HR可读也不外发。处理写许可须匹配当前account/collection/memberRevision，不能用读取许可、quotaScope或创建者身份替代。

加载及授权 → 有界读取原件 → 重载当前事实/核权 → 实际裁剪 → **再次重载当前事实/核权和版本** → 构造仅含裁后PNG的Modelink请求 → 返回前重核。摘要/来源区域、批次/item/成员revision或许可变化就拒绝，旧裁图不能复用。payload只含固定转录指令与裁后data URL，没有原始字节、完整原图URL、人员ID、存储key或凭证。

本片是新图片字节边界，直接使用899授权核完整image provenance；没有把图片伪造成P0 document/recording出处来绕过类型。835旧TalentSourceLocation尚不含image，873的完整图片来源/当前处理适配和公共模型输入组合仍须X1显式接线；当前工厂未注册到生产入口。

## 模型结果与预算的实际含义

客户端为843的ModelinkMaasClient；默认测试只调用实际createFakeModelinkMaas协议。schema只接受text、observedNames和legibility。姓名即使唯一也仅为unknown_person待核对提示，不查目录猜身份；不可靠手写为unreliable_transcription待核对。没有姓名的可读输出仍为`origin: ai_transcription`候选，不能直接作为人工结论、正式事件或确认分。本片不持久化待核对项，不编造itemId/回执或恢复成功。

预算显式注入并校验为有限正数：输入字节、width/height、像素、解码样本估算字节、输出字节、libvips处理秒数及yield后核算的elapsed。输出预算上限4MiB，与843一致；超限失败，不回退原图。maxDecodedBytes约束按原始像素/采样深度计算的RGBA样本预算，结合原生limitInputPixels/limitInputChannels；**不是RSS或原生总内存硬限**。

Sharp.timeout从libvips开始处理计时，不含排队；maxElapsedMs/AbortSignal在await返回后的检查也不声称立即终止原生操作。代码始终等待本次原生调用结束，没有Promise.race后遗留解码。作业级硬隔离/并发/总截止与生产取消仍须后续实际执行器提供，本片不新建worker或改全局Sharp并发/cache。

## 依赖和复验

作者不改根package.json/pnpm-lock.yaml，也不深引Next内部。隔离目录显式临时manifest以main精确直接版本为基础，仅增加dependencies.sharp=0.35.5，复制当前锁后只在临时目录重生成importer。固定契约/authz/maas原始源码与本片文件组合，证据标`isolated_frozen_input_combination`；不是裸仓或生产验收。

定向命令：`pnpm exec vitest run src/server/usecases/material-images --maxWorkers=2`。覆盖率显式include本片crop.ts/policy.ts，沿仓库行/分支85%门槛。真实像素oracle为独立原图解码后的预定行切片及硬编码的八方向框；模型协议fake截获并解码实际发送PNG。测试不替换Sharp裁剪、不真实调用模型、不读凭证/PG、不启动开发服务。

稳定head停推后交X1沿原分支只追加sharp0.35.5直接runtime及锁文件，做冻结安装/类型/实际定向复验，再交回；Optional依赖标记变化按实际锁语义审计。依赖、897/899/843/873及真实链未合，保持Draft+blocked，不关闭整卡。
