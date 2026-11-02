import { expect, it } from 'vitest';
import {
  NodeConclusionError,
  type NodeConclusionVersion,
} from '../node-conclusion';
import type { nodeConclusionVersions } from './schema';
import { decodeStoredNodeConclusion } from './stored-version';

function fixture(): typeof nodeConclusionVersions.$inferSelect {
  const payload: NodeConclusionVersion = {
    id: 'conclusion-demo',
    evaluationNodeId: 'defense-demo',
    personId: 'person-demo',
    version: 2,
    conclusionType: 'defense',
    origin: 'human_conclusion',
    conclusion: '演示：保留人工结论与历史依据。',
    confirmedBy: { id: 'hr-demo', name: '演示·HR' },
    confirmedAt: '2026-09-04T12:00:00Z',
    basis: {
      scoreConfirmationRevision: 'scores-demo-v2',
      confirmations: [
        {
          confirmationId: 'confirmation-demo',
          evaluatorId: 'judge-demo',
          version: 3,
          confirmedAt: '2026-09-03T12:00:00Z',
        },
      ],
      references: [
        {
          fragmentId: 'fragment-demo',
          originalVersionId: 'original-demo-v1',
          location: { kind: 'presentation', slide: 2 },
        },
      ],
    },
  };
  return {
    conclusionId: payload.id,
    version: payload.version,
    evaluationNodeId: payload.evaluationNodeId,
    personId: payload.personId,
    payload,
  };
}

function expectConflict(row: unknown) {
  let error: unknown;
  try {
    decodeStoredNodeConclusion(row);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(NodeConclusionError);
  expect(error).toMatchObject({
    code: 'conflict',
    message: '已存节点结论不可用',
  });
  expect(error).not.toHaveProperty('cause');
  expect(error).not.toHaveProperty('issues');
  expect(JSON.stringify(error)).not.toMatch(/secret|fragment-demo|person-demo/);
}

it('解码真实五列版本行，保留精确历史内容且不把存储身份列带入结果', () => {
  const row = fixture();
  const result = decodeStoredNodeConclusion(row);
  expect(result).toEqual(row.payload);
  expect(result).not.toBe(row.payload);
  expect(result).not.toHaveProperty('conclusionId');
  expect(result.version).toBe(2);
  expect(result.basis.confirmations[0]!.version).toBe(3);
});

it('返回完整深冻结的独立副本，不冻结或改写数据库输入', () => {
  const row = fixture();
  const before = structuredClone(row);
  const result = decodeStoredNodeConclusion(row);
  for (const value of [
    result,
    result.confirmedBy,
    result.basis,
    result.basis.confirmations,
    result.basis.confirmations[0],
    result.basis.references,
    result.basis.references[0],
    result.basis.references[0]!.location,
  ]) {
    expect(Object.isFrozen(value)).toBe(true);
  }
  expect(row).toEqual(before);
  expect(Object.isFrozen(row.payload)).toBe(false);
  expect(Object.isFrozen(row.payload.basis.references[0]!.location)).toBe(
    false,
  );
  row.payload.confirmedBy.name = '演示·变更';
  row.payload.basis.confirmations[0]!.version = 4;
  row.payload.basis.references[0]!.location = {
    kind: 'presentation',
    slide: 9,
  };
  expect(result).toEqual(before.payload);
  expect(() => {
    result.confirmedBy.name = '演示·不能修改';
  }).toThrow(TypeError);
});

it.each([null, undefined, [], 'secret-row', 0, true, {}, { payload: null }])(
  '未知输入%j不能被当作版本行',
  (row) => expectConflict(row),
);

it.each([
  'conclusionId',
  'version',
  'evaluationNodeId',
  'personId',
  'payload',
] as const)('拒绝缺少原生列%s', (key) => {
  const row: Record<string, unknown> = { ...fixture() };
  delete row[key];
  expectConflict(row);
});

it.each([
  ['conclusionId', 'id'],
  ['version', 'version'],
  ['evaluationNodeId', 'evaluationNodeId'],
  ['personId', 'personId'],
] as const)('逐项核对%s与payload.%s，不接受错位或类型强转', (column, key) => {
  const row = fixture();
  expectConflict({
    ...row,
    [column]: column === 'version' ? 3 : 'other-secret',
  });
  expectConflict({ ...row, [column]: column === 'version' ? '2' : 2 });
  expectConflict({
    ...row,
    payload: { ...row.payload, [key]: key === 'version' ? 3 : 'other-secret' },
  });
});

it.each([
  ['conclusionId', 'id'],
  ['evaluationNodeId', 'evaluationNodeId'],
  ['personId', 'personId'],
] as const)('身份%s不借trim把存储错位静默修复', (column, key) => {
  const row = fixture();
  const padded = ` ${row.payload[key]} `;
  expectConflict({ ...row, [column]: padded });
  expectConflict({ ...row, payload: { ...row.payload, [key]: padded } });
  expectConflict({
    ...row,
    [column]: padded,
    payload: { ...row.payload, [key]: padded },
  });
});

it.each([0, -1, 1.5, NaN, Infinity, '2', null])(
  '拒绝非法版本%j，即使双边相同',
  (version) => {
    const row = fixture();
    expectConflict({ ...row, version, payload: { ...row.payload, version } });
  },
);

it.each([null, [], 'secret-payload', {}, { origin: 'secret-ai' }])(
  '损坏payload%j统一为安全conflict',
  (payload) => expectConflict({ ...fixture(), payload }),
);

it.each([
  { origin: 'ai_inference' },
  { conclusionType: 'interview' },
  { conclusion: ' ' },
  { confirmedAt: 'secret-invalid-time' },
  { confirmedBy: { id: 'hr-demo', name: '' } },
  { secret: 'secret-extra-field' },
])('沿用领域版本schema拒绝非法payload %j', (change) => {
  const row = fixture();
  expectConflict({ ...row, payload: { ...row.payload, ...change } });
});

it.each([
  'empty_references',
  'duplicate_references',
  'invalid_location',
  'empty_confirmations',
  'duplicate_confirmations',
  'invalid_confirmation',
  'missing_revision',
] as const)('不绕过领域依据校验：%s', (mode) => {
  const row = fixture();
  const basis = row.payload.basis;
  if (mode === 'empty_references') basis.references = [];
  if (mode === 'duplicate_references')
    basis.references.push(structuredClone(basis.references[0]!));
  if (mode === 'invalid_location')
    basis.references[0]!.location = { kind: 'presentation', slide: 0 };
  if (mode === 'empty_confirmations') basis.confirmations = [];
  if (mode === 'duplicate_confirmations')
    basis.confirmations.push(structuredClone(basis.confirmations[0]!));
  if (mode === 'invalid_confirmation')
    basis.confirmations[0]!.confirmedAt = 'secret-time';
  if (mode === 'missing_revision') basis.scoreConfirmationRevision = '';
  expectConflict(row);
});

it('读取损坏字段抛出的原始错误也不会携带payload或cause返回', () => {
  const row = {
    ...fixture(),
    get payload(): never {
      throw new Error('secret-raw-payload');
    },
  };
  expectConflict(row);
});
