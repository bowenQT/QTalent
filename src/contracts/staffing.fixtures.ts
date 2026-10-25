import type { StaffingPage } from './staffing';

const source = {
  fragmentId: 'demo-fragment-1',
  originalVersionId: 'demo-version-1',
  location: { kind: 'document' as const, paragraph: '演示段落 1' },
  excerpt: '演示：独立交付服务端模块。',
  sourceType: 'document' as const,
  sourceCategory: 'original' as const,
  demo: true,
};

export function staffingFixture(): StaffingPage {
  return {
    demand: {
      id: 'demo-demand',
      projectId: 'demo-project',
      revision: 1,
      inputText: '演示：寻找服务端负责人',
      requirements: [
        { id: 'required-1', text: '独立交付模块', priority: 'required' },
        { id: 'bonus-1', text: '有语音经验', priority: 'bonus' },
      ],
      status: 'confirmed',
      confirmedBy: { id: 'demo-reviewer', name: '演示审核人' },
      confirmedAt: '2026-10-25T10:00:00Z',
    },
    candidates: [
      {
        person: { id: 'demo-person', name: '演示候选人', orgName: '演示部门' },
        demandRevision: 1,
        requirements: [
          {
            requirementId: 'required-1',
            progress: 'completed',
            aiJudgment: {
              conclusion: 'supported',
              rationale: '演示：存在对应交付材料',
              sources: [source],
            },
            humanJudgment: null,
          },
          {
            requirementId: 'bonus-1',
            progress: 'awaiting_manual',
            aiJudgment: null,
            humanJudgment: null,
          },
        ],
      },
    ],
    plan: { status: 'not_connected' },
  };
}
