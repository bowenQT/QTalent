# BOW-905：真实图片裁剪与外发门禁小片

## 范围与输入版本

当前普通组合基线 main `fe34b6faffcfb2832a1be266a155f0d7d19d69cc`，消费其中最终897核对合同、实际899节点授权与843 Modelink协议。旧组件通过仅覆盖原92f88be，不作为本次新增生产接线的验收。Sharp 精确 `0.35.5`，X1选型及两包文件窗口见 #248/6548950329。

仅PNG、JPEG、WebP输入，按真实容器签名及解码格式核MIME；输出统一PNG。PNG是外发格式，不是限制只接PNG。当前文件不包含生产reader/存储/事务、worker、845恢复或公开HTTP。最终897已规定整张仅附件终态及resume:null；本片实现该状态的零读取/零外发，真实解决与撤销仍待共享人审账本接线。

## 实际裁剪

`cropMaterialImage`只变换字节，不授予访问许可。输入为已经绑定原件ID、独立原件版本、批准原图区域及SHA256的内存字节。首次OCR允许`source:null`，不伪造fragment；已有canonical source时，其版本及区域必须与独立描述完全一致。先核输入预算和摘要，复制缓冲避免跨await修改，再核容器和实际解码格式。PNG动画控制区块、WebP动画标志/ANIM/ANMF、重复图像块、JPEG多图/MPF或拼接尾随内容均拒绝，不静默取首帧。原件路径、任意URL及image/*通配输入不进入解码器。

897区域是**存储原图、裁剪前的归一化坐标**。`displayToStoredRegion`只按可信EXIF方向1～8反映射显示框；生产调用方须从已验证原件取得方向，不能相信请求自报方向。输入给裁剪器的region始终是存储坐标。按原始width/height执行左/上ceil、右/下floor；没有完整像素就拒绝。裁前不autoOrient、不resize；输出保持存储像素方向，EXIF被移除。UI框选/回看接线必须使用相同反映射，尚未在本片声称接通。

使用真实Sharp.extract，转sRGB、裁后白底消除透明RGB隐藏内容，再重编码PNG；不保留原EXIF/XMP/ICC、缩略图或原始文件缓冲。canonical source保持不变（尚未生成时保持null），`pixelRegion`和`actualRegion`另记实际向内取整后的子区域，不能伪造新持久片段。原图ID/version/hash、裁后hash及模型/提示版本随候选追溯；这些标识不交给模型。

## 完整来源与当前许可

`createImageDisclosureGate`必须显式提供clock、预算、真实Modelink接口、loadCurrent和有界readOriginal，没有fake生产默认。loadCurrent是未来**可信服务端适配器**：读当前batch/material/item与成员revision、不可变原件/source/hash/MIME/字节数、绑定同一原件版本及revision的已核范围和全部共有人，另读当前899节点事实与846独立处理写许可。不得把请求里的人员/角色/框、旧页面筛选列表或选定节点装成这些事实。

门禁核全体范围，不以裁剪逃过原图含越权或未知人员的约束。每位共有人都须属于当前批次成员和节点，对全部kind/requiredKinds同时满足source-read与model-input；performance材料即使HR可读也不外发。处理写许可须匹配当前account/collection/memberRevision，不能用读取许可、quotaScope或创建者身份替代。

加载及授权 → 有界读取原件 → 重载当前事实/核权 → 实际裁剪 → **再次重载当前事实/核权和版本** → 构造仅含裁后PNG的Modelink请求 → 返回前重核。摘要/来源区域、批次/item/成员revision或许可变化就拒绝，旧裁图不能复用。payload只含固定转录指令与裁后data URL，没有原始字节、完整原图URL、人员ID、存储key或凭证。

本片是新图片字节边界，直接使用899授权核完整image provenance；没有把图片伪造成P0 document/recording出处来绕过类型。873的完整图片来源/当前处理适配和公共模型输入组合仍须X1显式接线；当前工厂未注册到生产入口。

## 模型结果与预算的实际含义

客户端为843的ModelinkMaasClient；默认测试只调用实际createFakeModelinkMaas协议。schema只接受text、observedNames和legibility。姓名即使唯一也仅为unknown_person待核对提示，不查目录猜身份；不可靠手写为unreliable_transcription待核对。没有姓名的可读输出仍为`origin: ai_transcription`候选，不能直接作为人工结论、正式事件或确认分。本片不持久化待核对项，不编造itemId/回执或恢复成功。

预算显式注入并校验为有限正数：输入字节、width/height、像素、解码样本估算字节、输出字节、libvips处理秒数及yield后核算的elapsed。输出预算上限4MiB，与843一致；超限失败，不回退原图。maxDecodedBytes约束按原始像素/采样深度计算的RGBA样本预算，结合原生limitInputPixels/limitInputChannels；**不是RSS或原生总内存硬限**。

Sharp.timeout从libvips开始处理计时，不含排队；maxElapsedMs/AbortSignal在await返回后的检查也不声称立即终止原生操作。代码始终等待本次原生调用结束，没有Promise.race后遗留解码。作业级硬隔离/并发/总截止与生产取消仍须后续实际执行器提供，本片不新建worker或改全局Sharp并发/cache。

## 依赖和复验

X1已在原分支提交Sharp直接依赖和锁文件；本轮沿原分支普通合最新main，使用真实仓库锁做冻结离线安装，不复制契约或隔离manifest。作者不修改根package.json/pnpm-lock.yaml。

生产代码依赖与卡剩余范围分开记录：873固定`2c3ee54eecd896915ca0067fc2f7463c99aa8936`提供真实上传与collection，但UploadCompletion.source仍明确null；926固定`8a0cc9d54c5bdfb6dcbea7057afa68b093a85318`的canonical writer必须在成功OCR后以真实job fence调用，不能为第一次OCR先造解析成功。#322固定`ca0ea8759b217e9841cb656c0948af631adadec0`是保存/确认ledger，并非未解析图片的完整许可。X1的人审账本/公共出口/实际组合与845唯一恢复producer尚未交付，本片不以空端口或fake测试宣称原生接线完成。

`attachment_only`在读取当前处理身份、成员与绑定版本后直接返回终态；不读原图，不发送模型，不生成恢复job或额外核对项，也不授予附件读取许可。实际查看附件仍须另一真实reader按整张全部主体/种类逐次授权；未知范围拒绝。旧执行在读取或模型返回期间遇到该状态变化，不能继续提交旧结果。

定向命令：`pnpm exec vitest run src/server/usecases/material-images --maxWorkers=2`。覆盖率显式include本片crop.ts/policy.ts，沿仓库行/分支85%门槛。真实像素oracle为独立原图解码后的预定行切片及硬编码的八方向框；模型协议fake截获并解码实际发送PNG。测试不替换Sharp裁剪、不真实调用模型、不读凭证/PG、不启动开发服务。

目前真实图片门禁组件与生产接线分开验收。待共享结构到位后补真实原件适配、review/解除/undo原生事务、恢复幂等及实际PG测试；依赖与默认CI齐备后才能转Ready。未运行真实供应商调用，不关闭整卡。
