import type { ShellData } from '@/contracts/shell';
import type { RecordBatchDraft } from '@/contracts/record';
import type { MaterialSourceReference } from '@/contracts/sources';
import type {
  AnchorSet,
  DimensionOption,
  PersonOption,
  ProjectOption,
} from '@/features/record/types';
import { hrPeople, mentorPeople } from './sample-people';

/**
 * Sample data for the record page on the stand-in server (the real route reads BOW-845
 * and saves through BOW-846). Pseudonyms, dimensions, anchors and the
 * arranged result for the example sentence come from prototype Y (data.js DIMS and
 * ANCHORS, parse.js shape() on the placeholder sentence, at 81e4fd4); not real people
 * and not a fallback for the real page.
 */
export type SampleRole = 'hr' | 'mentor' | 'manager';
export type SampleScene =
  | 'normal'
  | 'fail'
  | 'offline'
  | 'conflict'
  | 'many'
  | 'review'
  | 'node-multiple'
  | 'node-none';

const accounts: Record<
  SampleRole,
  { id: string; name: string; label: string; scope: string; hue: number }
> = {
  hr: {
    id: 'p-suwan',
    name: '苏晚',
    label: 'HR',
    scope: 'XEngineer、Landing、校招、黑客松',
    hue: 340,
  },
  mentor: {
    id: 'p-yeqing',
    name: '叶青',
    label: '导师',
    scope: '分镜工厂 · 二组、口语搭子 · 一组的学员',
    hue: 160,
  },
  manager: {
    id: 'p-cheng',
    name: '程远',
    label: '管理者',
    scope: '全公司',
    hue: 220,
  },
};

export const sampleAccount = (role: SampleRole) => accounts[role];

export function sampleShell(role: SampleRole): ShellData {
  const account = accounts[role];
  return {
    account: {
      id: account.id,
      name: account.name,
      email: `${role}@sample.test`,
      roles: [role],
      hue: account.hue,
      roleLabel: account.label,
      scopeLabel: account.scope,
    },
    navigation: [
      { id: 'work', label: '工作台', href: '/work', icon: 'home', group: null },
      {
        id: 'projects',
        label: '项目与课题',
        href: '/projects',
        icon: 'folder',
        group: null,
      },
    ],
    counts: { status: 'not_connected' },
    recent: { status: 'not_connected' },
    canSearch: false,
    isAdmin: false,
    role,
  };
}

export function samplePeople(role: SampleRole): PersonOption[] {
  return (role === 'mentor' ? mentorPeople : hrPeople).map(
    ([id, name, hue, photo, orgShort]) => ({
      id,
      name,
      hue,
      photo,
      orgShort,
      demo: true,
    }),
  );
}

export const sampleProjects: ProjectOption[] = [
  { id: 't-scene-b', name: '分镜工厂 · 二组', kind: 'topic' },
  { id: 't-talk-a', name: '口语搭子 · 一组', kind: 'topic' },
];

export const sampleDimensions: DimensionOption[] = [
  { id: 'prof', name: '专业度' },
  { id: 'mot', name: '内生动力' },
  { id: 'wis', name: '智慧力' },
  { id: 'grit', name: '坚毅力' },
  { id: 'lead', name: '领导力' },
  { id: 'open', name: '开放性' },
];

export const RULE_VERSION = 'rubric-v1';
const potential: AnchorSet['levels'] = [
  '本次出现与该维度相反的明确行为',
  '相关行为偶发，需要他人推动才发生',
  '常规情境下稳定表现出该维度的行为',
  '有难度或模糊的情境下主动表现，并有可见结果',
  '高难情境下表现突出，并带动他人或形成可复用的方法',
];
const professional: AnchorSet['levels'] = [
  '明显低于本届学员预期',
  '部分达到本届学员预期',
  '达到本届学员预期',
  '超出本届学员预期',
  '可以承担正式岗位的职责',
];
export const sampleAnchors = (dimensionId: string): AnchorSet => ({
  ruleVersion: RULE_VERSION,
  family: null,
  levels: dimensionId === 'prof' ? professional : potential,
});

/** The placeholder sentence; the prototype arranges it into the draft below. */
export const SENTENCE =
  '孟逸尘今天主动把任务池同步给了全组，下午组员就接上了，分工比之前清楚多了。';
export const SUBJECT = 'p-x11';
const QUOTE = '孟逸尘今天主动把任务池同步给了全组';

/** The typed text is the batch's text material; citations into it are inline quotes. */
export function textReference(batchId: string): MaterialSourceReference {
  return {
    fragmentId: `${batchId}-text`,
    originalVersionId: `${batchId}-text-v1`,
    location: { kind: 'document', paragraph: '原话' },
  };
}

/**
 * What the prototype makes of the sentence: one suggested score with its anchor and
 * quote, and one dimension left open because the sentence shows nothing for it. Any
 * other sentence keeps both open: the sample never scores without a quote.
 */
export function sampleDraft({
  batchId,
  draftId,
  evaluationNodeId,
  personId,
  text,
  revision = 1,
}: {
  batchId: string;
  draftId: string;
  evaluationNodeId: string;
  personId: string;
  text: string;
  revision?: number;
}): RecordBatchDraft {
  const reference = textReference(batchId);
  return {
    batchId,
    evaluationNodeId,
    draftId,
    revision,
    origin: 'ai_suggestion',
    personIds: [personId],
    projectId: null,
    sourceReferences: [reference],
    dimensionVersionId: RULE_VERSION,
    anchorVersionId: RULE_VERSION,
    sbi: {
      title: '主动把任务池同步给了全组，下午组员就接上了，分工…',
      situation: '',
      behavior:
        '主动把任务池同步给了全组，下午组员就接上了，分工比之前清楚多了',
      impact: '',
    },
    scores: [
      text.includes(QUOTE)
        ? {
            personId,
            dimensionId: 'mot',
            state: 'suggested',
            value: 4,
            anchor: {
              id: 'mot-4',
              text: potential[3],
              ruleVersion: RULE_VERSION,
            },
            citations: [{ kind: 'source', quote: QUOTE, reference }],
          }
        : {
            personId,
            dimensionId: 'mot',
            state: 'unknown',
            reason: '原话里的具体行为待补充',
          },
      {
        personId,
        dimensionId: 'grit',
        state: 'unknown',
        reason: '受挫后的反应待补充',
      },
    ],
  };
}
