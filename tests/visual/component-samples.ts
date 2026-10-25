export const componentSamples = [
  {
    name: 'input-field',
    reference: '#c-controls .ds-stage > .n-field:first-child',
    actual: '[data-sample="field"] .n-field',
    text: '项目名称',
  },
  {
    name: 'button',
    reference: '#c-controls button.n-btn[data-open="dlg-delete"]',
    actual: '[data-sample="button"] button:first-child',
    text: '删除「海外加速搜索体验」',
  },
  {
    name: 'badge',
    reference: '.state-table .n-badge--yes',
    actual: '[data-sample="badge"] .n-badge',
    text: '支持',
  },
] as const;
