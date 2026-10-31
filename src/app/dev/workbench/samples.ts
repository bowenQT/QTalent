import type { ShellData } from '@/contracts/shell';
import type { WorkbenchRole, WorkbenchView } from '@/features/workbench/view';

/**
 * Sample views for comparing the workbench sections with prototype Y while the real read
 * (BOW-838) and the revised contract (#202) are not on main. Demo pseudonyms and values
 * from the prototype Y seed (?as=ceo|hrbp|mentor at 2026-09-04); not real people and not
 * a fallback for the real page.
 */
const asOf = '2026-09-04';
const mentorTrainees: [string, string, string, string | null][] = [
  ['p-x06', '季思齐', '口语搭子 · 一组', 'he-yining'],
  ['p-x07', '孟映雪', '口语搭子 · 一组', null],
  ['p-x08', '谷嘉树', '口语搭子 · 一组', null],
  ['p-x09', '沈承宇', '口语搭子 · 一组', null],
  ['p-x10', '云致远', '口语搭子 · 一组', null],
  ['p-x11', '孟逸尘', '分镜工厂 · 二组', 'song-xiaoman'],
  ['p-x12', '沈亦初', '分镜工厂 · 二组', null],
  ['p-x13', '季叙白', '分镜工厂 · 二组', null],
  ['p-x14', '方景深', '分镜工厂 · 二组', null],
  ['p-x15', '周初晴', '分镜工厂 · 二组', null],
];

export const sampleViews: Record<WorkbenchRole, WorkbenchView> = {
  manager: {
    role: 'manager',
    displayName: '程远',
    asOf,
    entries: { record: true, findPeople: true },
    accountId: 'sample-ceo',
    namedExamples: true,
  },
  hr: {
    role: 'hr',
    displayName: '苏晚',
    asOf,
    entries: { record: true, findPeople: true },
    accountId: 'sample-hrbp',
    namedExamples: true,
  },
  mentor: {
    role: 'mentor',
    displayName: '叶青',
    asOf,
    entries: { record: true, findPeople: false },
    accountId: 'sample-mentor',
    namedExamples: true,
    trainees: {
      status: 'ready',
      data: mentorTrainees.map(([id, name, topic, photo]) => ({
        id,
        name,
        hue: null,
        photo,
        topic,
        activity: {
          status: 'ready',
          data: { recordedThisWeek: 0, lastRecordedOn: '2026-08-28' },
        },
      })),
    },
  },
};

// Role line of the prototype shell (data.js ROLES), so the page above the workbench has
// the same height on both sides.
const roleLines: Record<WorkbenchRole, [label: string, scope: string]> = {
  manager: ['管理者', '公司层：看人、找人，确认规则与方案'],
  hr: ['HR', '人才项目：XEngineer、Landing、校招、黑客松'],
  mentor: ['导师', '分镜工厂 · 二组、口语搭子 · 一组的学员'],
};

export function sampleShell(role: WorkbenchRole): ShellData {
  const view = sampleViews[role];
  return {
    account: {
      id: view.accountId,
      name: view.displayName,
      email: `${role}@sample.test`,
      roles: [role],
      hue: 220,
      roleLabel: roleLines[role][0],
      scopeLabel: roleLines[role][1],
    },
    navigation: [
      { id: 'work', label: '工作台', href: '/work', icon: 'home', group: null },
    ],
    counts: { status: 'not_connected' },
    recent: { status: 'not_connected' },
    canSearch: false,
    isAdmin: false,
    role,
  };
}
