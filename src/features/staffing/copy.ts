/** Wording from prototype Y (prototype/y/app/js/pages/staffing.js) unless marked new. */
export const entryTitle = '为一个项目或关键岗位找人';
export const entryLede =
  '说一句要做什么、要什么样的人，或者从目标角色模板开始。';
export const entryPlaceholder =
  '比如：语音硬件端云联调要找一个能打通设备端和服务端的 owner，10 月到岗';
export const entrySayings = [
  '语音硬件端云联调要找一个能打通设备端和服务端的 owner，10 月到岗',
  '智能体平台应用后端要找一个 owner',
  'TS 新人组还缺一个懂测试和部署、能带大家对齐节奏的人',
] as const;
export const generatingTitle = '为一个项目找人';

export const demandBadge = 'AI 起草 · 点要求可以改写，点「必须 / 加分」切换';
export const addPlaceholder = '补一句要求，比如：10 月能到岗';
export const demandCaption = '改了要求，候选人会按新要求重新核对。';
export const pendingCaption =
  '资料待补充的人放在这里，补齐后再看是否满足。进入正式方案前再核对关键条件。';
export const noCandidates = {
  title: '换个条件再找',
  text: '可以先补材料，或者放宽一项要求。',
};

// New: the prototype matches as soon as the card appears; the contract matches only
// after the demand is confirmed (BOW-853 10/31). Pending design confirmation (BOW-925).
export const confirmCaption =
  '确认之后才开始核对候选人；确认后再改要求，要重新确认。';
export const confirmedLine = (name: string, at: string) =>
  `${name} ${at} 确认 · 按这版要求核对候选人`;
export const matchingUnavailable = {
  title: '候选人核对还没接通',
  text: '需求已确认。核对服务接通后，候选人按这版要求出现在这里。',
};
export const matchingFailed = {
  title: '候选人核对没有完成',
  text: '需求和已核对的结果都保留着，可以稍后刷新再看。',
};
export const demandFailed = {
  title: '需求卡没有生成',
  text: '你说的那句话还在输入框里，可以再试一次。',
};
export const conflictText = '需求已变化，请保留输入并刷新';
export const forbiddenText = '你没有执行此操作的权限';

// New: manual judgment, composed from the judgment attribution pattern (judge.js).
export const manualTitle = '这条要求要你来判断';
export const manualReason = '理由（必填，会署名留档）';
export const manualReasonPlaceholder =
  '比如：观察表里写了牵头分工，但没有说是否担任组长';
export const manualSources = '依据（明确结论至少选一条）';
export const manualNoSources =
  '这位候选人还没有可以引用的来源，只能先判为资料不足。';
export const manualSign = '确认后署名留档。';
export const failedNote = '这一条没有判断出来，结论空着，不算作任何一种状态。';
