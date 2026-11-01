/**
 * Wording from prototype Y (prototype/y/app/js/pages/staffing.js) unless marked new.
 * New and changed lines follow docs/ui-copy.md: what is true now and what to do next.
 */
export const entryTitle = '为一个项目或关键岗位找人';
// The prototype adds「或者从目标角色模板开始」; templates are not on this page.
export const entryLede = '说一句要做什么、要什么样的人。';
export const entryPlaceholder =
  '比如：语音硬件端云联调要找一个能打通设备端和服务端的 owner，10 月到岗';
export const entrySayings = [
  '语音硬件端云联调要找一个能打通设备端和服务端的 owner，10 月到岗',
  '智能体平台应用后端要找一个 owner',
  'TS 新人组还缺一个懂测试和部署、能带大家对齐节奏的人',
] as const;
export const generatingTitle = '为一个项目找人';
// New (owner ruling 11/1, #248): entered from a project, the page names the project and
// shows no general sayings, which would be saved under this project whatever they say.
export const projectTitle = (name: string) => `为「${name}」找人`;
export const projectEntryLede = '说一句这个项目要什么样的人。';
export const projectEntryPlaceholder =
  '比如：要负责哪一块、需要哪些经验、什么时候到岗';

// The prototype adds「点要求可以改写」; rewriting a requirement is not on this page.
export const demandBadge = 'AI 起草 · 点「必须 / 加分」切换';
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
export const confirmButton = '确认需求';
export const confirmCaption = '确认后开始核对候选人；改了要求要重新确认。';
export const confirmedLine = (name: string, at: string) =>
  `${name} ${at} 确认 · 按这版要求核对候选人`;
export const matchingUnavailable = {
  title: '候选人核对待接通',
  text: '需求已确认。核对接通后，候选人按这版要求出现在这里。',
};
export const matchingFailed = {
  title: '候选人核对中断',
  text: '需求和已核对的结果都已保留，可以稍后刷新再看。',
};
export const draftFailed = '需求卡生成失败，回到输入框再发一次。';
export const draftSignedOut = '登录已失效，重新登录后回到输入框再发一次。';
export const draftOutOfScope =
  '起草结果现在在你的查看范围之外，可以回到输入框再发一次。';
export const draftGone = '这次起草的记录已失效，回到输入框再发一次。';
/** A resumed drafting job whose demand belongs to another project: it is not opened here. */
export const draftOtherProject =
  '这次起草的需求属于另一个项目，没有在这里打开。回到输入框，为这个项目再发一次。';
export const draftRetrying =
  '起草进度读取中断，正在重试。也可以回到输入框再发一次。';
export const conflictText = '需求已变化，请保留输入并刷新';
export const outOfScope = '这次核对在你的查看范围之外';
export const demandOutOfScope =
  '这份需求现在在你的查看范围之外，刷新后按当前权限查看';
export const saveFailed = '保存失败，请检查后再试一次';
export const offline = '保存失败，请检查网络后再试一次';
export const matchingLoading = '候选人核对中';

// New: manual judgment, composed from the judgment attribution pattern (judge.js).
export const manualTitle = '这条要求要你来判断';
export const manualReason = '理由（必填，会署名留档）';
export const manualReasonPlaceholder =
  '比如：观察表写了牵头分工，担任组长的记录待补充';
export const manualSources = '依据（明确结论至少选一条）';
export const manualNoSources = '这位候选人的来源待补充，先判为资料不足。';
export const manualSign = '确认后署名留档。';
export const failedNote = '判断失败，结论留空，待重新判断。';
