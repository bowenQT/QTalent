/** Fixed pseudonymous demonstrations for BOW-871; these are reference labels, not model accuracy. */
export const staffingMatchingSamples = [
  {
    demo: true,
    id: 'demo-a',
    name: '演示·林序',
    behavior: '林序独立拆解验收清单，协调两组补齐接口，并按期交付。',
    conclusion: 'supported',
  },
  {
    demo: true,
    id: 'demo-b',
    name: '演示·顾澄',
    behavior: '顾澄负责验收清单，但明确遗漏已约定的核心接口，复核后仍未补齐。',
    conclusion: 'not_supported',
  },
  {
    demo: true,
    id: 'demo-c',
    name: '演示·陆星',
    behavior:
      '陆星参加项目例会，材料只记录团队交付，没有其个人负责的验收行为。',
    conclusion: 'insufficient',
  },
  {
    demo: true,
    id: 'demo-d',
    name: '演示·闻溪',
    behavior:
      '同次验收记录一称闻溪已补齐全部接口，记录二称同一清单核心接口未补齐，尚未核实。',
    conclusion: 'conflict',
  },
] as const;
