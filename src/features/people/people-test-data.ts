import { peopleListSchema, type PeopleList } from '@/contracts/people';

/** Synthetic people for unit tests; every name is a pseudonym marked 演示. */
type Seed = {
  id: string;
  name: string;
  team: [id: string, name: string];
  batch?: string;
  load?: [current: number, ever: number];
  position?: 'hh' | 'hl' | 'lh' | 'll' | 'insufficient' | 'unknown';
  facts?: boolean;
  lines?: boolean;
};
const QUADRANT = {
  hh: 'high_professional_high_potential',
  hl: 'low_professional_high_potential',
  lh: 'high_professional_low_potential',
  ll: 'low_professional_low_potential',
} as const;

function view(seed: Seed, role: PeopleList['role']) {
  const [teamId, teamName] = seed.team;
  const [current, ever] = seed.load ?? [0, 0];
  const shared = {
    role,
    person: {
      id: seed.id,
      name: seed.name,
      hue: 200,
      photo: null,
      demo: true,
      teamId,
      teamName,
      teamPath: `演示中心 / ${teamName}`,
      jobTitle: '后端工程师',
      level: 'P5',
      batch: seed.batch ? { id: 'cohort-6', name: seed.batch } : null,
      tenureLabel: '入营 3 个月',
    },
    projectLoad: { current, ever },
    recentFacts: seed.facts
      ? {
          status: 'ready',
          data: [
            {
              eventId: `${seed.id}-e1`,
              occurredOn: '2026-09-04',
              title: '需求变更后当天给出两个备选方案',
              projectName: '演示课题甲',
              recorderName: '演示导师',
              sources: [
                {
                  fragmentId: 'frag-1',
                  originalVersionId: 'ver-1',
                  location: { kind: 'document', paragraph: '3' },
                },
              ],
            },
            {
              eventId: `${seed.id}-e2`,
              occurredOn: '2026-08-20',
              title: '补齐接口文档',
              recorderName: '演示导师',
              sources: [
                {
                  fragmentId: 'frag-2',
                  originalVersionId: 'ver-1',
                  location: { kind: 'document', paragraph: '5' },
                },
              ],
            },
          ],
        }
      : { status: 'empty' },
    capabilityLines: seed.lines
      ? {
          status: 'ready',
          data: {
            lines: [
              {
                dimensionId: 'dim-pro',
                dimensionLabel: '专业度',
                eventCount: 2,
                topAnchor: '能独立拆解中等复杂度的需求',
              },
            ],
            uncoveredCount: 3,
          },
        }
      : { status: 'insufficient_evidence', reason: '暂无可用的已确认维度分' },
  };
  if (role === 'mentor') return shared;
  const position = seed.position ?? 'insufficient';
  return {
    ...shared,
    referencePosition:
      position === 'insufficient'
        ? { status: 'insufficient_evidence', reason: '潜力轴缺 2 条事件' }
        : position === 'unknown'
          ? { status: 'unknown', reason: '评价规则正在切换' }
          : {
              status: 'ready',
              data: { kind: 'reference', quadrant: QUADRANT[position] },
            },
  };
}

export function peopleList(
  role: PeopleList['role'],
  seeds: readonly Seed[],
): PeopleList {
  return peopleListSchema.parse({
    role,
    people: seeds.map((seed) => view(seed, role)),
    total: seeds.length,
  });
}

/** Two teams in server order; positions deliberately not in any sorted order. */
export const seeds: Seed[] = [
  {
    id: 'p1',
    name: '演示学员甲',
    team: ['t-a', '平台组'],
    batch: 'XEngineer 第六期',
    load: [1, 2],
    position: 'll',
    facts: true,
    lines: true,
  },
  {
    id: 'p2',
    name: '演示学员乙',
    team: ['t-a', '平台组'],
    load: [0, 2],
    position: 'insufficient',
  },
  {
    id: 'p3',
    name: '演示学员丙',
    team: ['t-b', '数据组'],
    batch: 'XEngineer 第六期',
    position: 'hh',
  },
  {
    id: 'p4',
    name: '演示学员丁',
    team: ['t-b', '数据组'],
    position: 'unknown',
  },
];
