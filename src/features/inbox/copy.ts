/**
 * Wording from prototype Y (prototype/y/app/js/pages/inbox.js) unless marked new.
 * New lines follow docs/ui-copy.md: what is true now and what to do next.
 */
// The prototype also asks about projects; that kind is resolved where the event is
// recorded (BOW-845), so the lede names the questions this page asks.
export const lede =
  '选出这几处说的是谁、整理哪一部分，选完即生效；整理出的建议分确认前，可以在「已核对」里撤销。';
export const allDone = {
  title: '都核对完了',
  text: '新的录音、文档、截图或面评里有需要确认的地方时，会出现在这里。',
};
export const restLater = (kindLabel: string | null, count: number) => ({
  title: kindLabel ? `${kindLabel}都核对完了` : '现在没有要核对的',
  text: `${count} 处放在了稍后处理，在「稍后处理」里继续核对。`,
});
export const undoneText = '已撤销，回到待核对';

// New: parts that have no read or command yet.
export const notConnected = {
  page: {
    title: '待核对待接通',
    text: '接通后，录音、文档、截图和面评里要你确认的地方会出现在这里。',
  },
  search: '待接通',
  scope: '框选范围待接通',
};

// New: a failure keeps the card and the choice; the server's own message is not shown.
export const failed = {
  conflict: '这一处刚有变化，刷新后再选',
  forbidden: '这一处现在在你的查看范围之外，刷新后按当前权限查看',
  not_found: '这一处已经处理过或已移走，刷新后再看',
  validation_error: '这次选择保存失败，请再选一次',
  offline: '保存失败，请检查网络后再试一次',
};
export const undoFailed = {
  conflict: '撤销失败：依赖这一处的内容已确认或已导入',
  other: '撤销失败，刷新后再看',
};
