import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { expect, it } from 'vitest';
import { createClock } from '../../../lib/clock';
import { createFakeModelinkMaas } from '../../integrations/maas/modelink';
import {
  createImageDisclosureGate,
  type ImageFacts,
  type ImageAuthority,
  type ImageGateDependencies,
} from './policy';
async function fixture() {
  const bytes = await sharp({
    create: { width: 8, height: 8, channels: 3, background: '#ff0000' },
  })
    .composite([
      {
        input: await sharp({
          create: { width: 4, height: 4, channels: 3, background: '#0080ff' },
        })
          .png()
          .toBuffer(),
        left: 2,
        top: 2,
      },
    ])
    .png()
    .toBuffer();
  const hash = createHash('sha256').update(bytes).digest('hex'),
    region = { left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 };
  const facts: ImageFacts = {
    materialId: 'material-a',
    batchId: 'batch-a',
    evaluationNodeId: 'node-a',
    revision: 2,
    batchRevision: 3,
    recordCollectionId: 'collection-a',
    memberRevision: 4,
    members: ['demo-a'],
    originalId: 'original-a',
    source: {
      fragmentId: 'fragment-a',
      originalVersionId: 'version-a',
      location: { kind: 'image', region },
    },
    sha256: hash,
    byteLength: bytes.length,
    mediaType: 'image/png',
    kind: 'evaluation',
    requiredKinds: [],
    cancelRequested: false,
    scope: {
      state: 'verified',
      originalVersionId: 'version-a',
      sha256: hash,
      revision: 2,
      region,
      subjects: [{ personId: 'demo-a', evaluationNodeId: 'node-a' }],
    },
  };
  const authority: ImageAuthority = {
    context: {
      account: { id: 'account-a', personId: 'hr', isSystemAdmin: false },
      now: '2026-09-04T00:00:00.000Z',
      grants: [
        {
          accountId: 'account-a',
          role: 'hr',
          scope: 'cohort',
          cohortId: 'cohort-a',
          validFrom: '2026-01-01',
          validTo: null,
          revokedAt: null,
        },
      ],
      people: [
        { id: 'demo-a', noReview: false },
        { id: 'outside', noReview: false },
      ],
      enrollments: [
        {
          personId: 'demo-a',
          cohortId: 'cohort-a',
          confirmed: true,
          validFrom: '2026-01-01',
          validTo: null,
          revokedAt: null,
        },
        {
          personId: 'outside',
          cohortId: 'cohort-b',
          confirmed: true,
          validFrom: '2026-01-01',
          validTo: null,
          revokedAt: null,
        },
      ],
      assignments: [],
      projects: [],
      members: [],
      evaluationNodes: [
        { id: 'node-a', kind: 'defense', cohortId: 'cohort-a' },
        { id: 'node-b', kind: 'defense', cohortId: 'cohort-b' },
      ],
      evaluationNodeSubjects: [
        { personId: 'demo-a', evaluationNodeId: 'node-a' },
        { personId: 'outside', evaluationNodeId: 'node-b' },
      ],
      evaluationRelations: [],
    },
    processing: {
      accountId: 'account-a',
      recordCollectionId: 'collection-a',
      memberRevision: 4,
      allowed: true,
    },
  };
  const f = {
    facts,
    authority,
    bytes,
    loads: 0,
    reads: 0,
    sent: [] as string[],
    afterRead: () => {},
    afterSend: () => {},
    output: {
      text: '演示·林序完成接口联调。',
      observedNames: ['演示·林序'],
      legibility: 'readable',
    },
  };
  const deps: ImageGateDependencies = {
    clock: createClock('test'),
    limits: {
      maxInputBytes: 4 * 1024 * 1024,
      maxWidth: 4096,
      maxHeight: 4096,
      maxPixels: 1000000,
      maxDecodedBytes: 8000000,
      maxOutputBytes: 4 * 1024 * 1024,
      processingSeconds: 2,
      maxElapsedMs: 6000,
    },
    loadCurrent: async (_a, _m, now) => {
      f.loads++;
      return {
        facts: structuredClone(f.facts),
        authority: {
          ...structuredClone(f.authority),
          context: { ...structuredClone(f.authority.context), now },
        },
      };
    },
    readOriginal: async (_facts, options) => {
      expect(options.maxBytes).toBe(deps.limits.maxInputBytes);
      f.reads++;
      f.afterRead();
      return f.bytes;
    },
    client: {
      async generateStructured(input) {
        for (const m of input.messages)
          if (Array.isArray(m.content))
            for (const part of m.content)
              if (part.type === 'image_url') f.sent.push(part.image_url.url);
        f.afterSend();
        return createFakeModelinkMaas(f.output).generateStructured(input);
      },
    },
  };
  const request = {
    materialId: 'material-a',
    originalVersionId: 'version-a',
    expectedRevision: 2,
  };
  return { f, deps, request, gate: createImageDisclosureGate(deps) };
}
it('真实裁剪后的PNG才进真实Modelink协议fake；姓名只有待核对提示，未生成身份或正式数据', async () => {
  const { f, gate, request } = await fixture();
  const result = await gate.parse('account-a', request);
  expect(result).toMatchObject({
    status: 'needs_review',
    reason: 'unknown_person',
    provenance: {
      model: 'google/gemini-3.8-flash',
      promptVersion: 'image-material-v1',
    },
    observedNames: ['演示·林序'],
    origin: 'ai_transcription',
  });
  expect(f.sent).toHaveLength(1);
  const sent = Buffer.from(f.sent[0]!.split(',')[1]!, 'base64');
  expect(sent.equals(f.bytes)).toBe(false);
  expect(await sharp(sent).metadata()).toMatchObject({
    format: 'png',
    width: 4,
    height: 4,
  });
  const pixels = await sharp(sent).removeAlpha().raw().toBuffer();
  expect([...pixels]).toEqual(
    Array.from({ length: 16 }, () => [0, 128, 255]).flat(),
  );
  expect(JSON.stringify(result)).not.toMatch(/personId|confirmed|score/);
  expect(f.loads).toBeGreaterThanOrEqual(3);
});
it.each([
  'unknown',
  'outside',
  'empty',
  'write_denied',
  'member_revision',
  'stale_item',
  'stale_original',
  'stale_proof',
  'performance',
  'missing_node',
  'wrong_account',
  'cancelled',
] as const)('%s时零外发', async (mode) => {
  const { f, gate, request } = await fixture();
  if (mode === 'unknown') f.facts.scope = { state: 'unknown' };
  if (mode === 'outside' && f.facts.scope.state === 'verified')
    f.facts.scope.subjects.push({
      personId: 'outside',
      evaluationNodeId: 'node-b',
    });
  if (mode === 'empty' && f.facts.scope.state === 'verified')
    f.facts.scope.subjects = [];
  if (mode === 'write_denied') f.authority.processing.allowed = false;
  if (mode === 'member_revision') f.authority.processing.memberRevision = 3;
  if (mode === 'stale_item') request.expectedRevision = 1;
  if (mode === 'stale_original') request.originalVersionId = 'old-version';
  if (mode === 'stale_proof' && f.facts.scope.state === 'verified')
    f.facts.scope.sha256 = '0'.repeat(64);
  if (mode === 'performance') f.facts.requiredKinds = ['performance'];
  if (mode === 'missing_node') f.authority.context.evaluationNodeSubjects = [];
  if (mode === 'wrong_account') f.authority.context.account.id = 'other';
  if (mode === 'cancelled') f.facts.cancelRequested = true;
  expect((await gate.parse('account-a', request)).status).not.toBe('candidate');
  expect(f.sent).toEqual([]);
});
it.each([
  'read_revocation',
  'crop_revocation',
  'read_version',
  'crop_version',
] as const)('%s异步后重新核查，模型仍零调用', async (mode) => {
  const { f, deps, request } = await fixture();
  if (mode === 'read_revocation')
    f.afterRead = () => {
      f.authority.processing.allowed = false;
    };
  if (mode === 'read_version')
    f.afterRead = () => {
      f.facts.batchRevision++;
    };
  const original = deps.loadCurrent;
  deps.loadCurrent = async (...args) => {
    const value = await original(...args);
    if (f.loads === 3) {
      if (mode === 'crop_revocation') f.authority.processing.allowed = false;
      if (mode === 'crop_version') f.facts.batchRevision++;
      return original(...args);
    }
    return value;
  };
  const result = await createImageDisclosureGate(deps).parse(
    'account-a',
    request,
  );
  expect(result.status).not.toBe('candidate');
  expect(f.sent).toEqual([]);
});
it('模型返回后失权不返回转录内容；不可靠手写仅待核对', async () => {
  const { f, gate, request } = await fixture();
  f.afterSend = () => {
    f.authority.processing.allowed = false;
  };
  expect(await gate.parse('account-a', request)).toMatchObject({
    status: 'forbidden',
  });
  const good = await fixture();
  good.f.output = { text: '', observedNames: [], legibility: 'uncertain' };
  expect(await good.gate.parse('account-a', good.request)).toMatchObject({
    status: 'needs_review',
    reason: 'unreliable_transcription',
  });
});
it('无姓名的可读转录仍是AI候选，未创建批次/事件/恢复任务', async () => {
  const { f, gate, request } = await fixture();
  f.output = {
    text: '演示项目已经完成接口联调。',
    observedNames: [],
    legibility: 'readable',
  };
  expect(await gate.parse('account-a', request)).toMatchObject({
    status: 'candidate',
    origin: 'ai_transcription',
  });
});
it('坏图/摘要不符/超预算/取消/伪造输入均不外发，依赖缺失不启用fake默认', async () => {
  const { f, deps, request } = await fixture();
  f.bytes = Buffer.from('broken');
  expect(
    (await createImageDisclosureGate(deps).parse('account-a', request)).status,
  ).toBe('failed');
  expect(f.sent).toEqual([]);
  const a = await fixture();
  a.deps.limits.maxOutputBytes = 8;
  expect(
    (await createImageDisclosureGate(a.deps).parse('account-a', a.request))
      .status,
  ).toBe('failed');
  expect(a.f.sent).toEqual([]);
  const b = await fixture(),
    abort = new AbortController();
  abort.abort();
  expect(
    (await b.gate.parse('account-a', b.request, abort.signal)).status,
  ).toBe('cancelled');
  expect(b.f.sent).toEqual([]);
  expect(
    (await b.gate.parse('account-a', { ...b.request, role: 'hr' })).status,
  ).toBe('validation_error');
  expect(() =>
    createImageDisclosureGate({
      ...deps,
      readOriginal: undefined,
    } as unknown as ImageGateDependencies),
  ).toThrow(/readOriginal/);
});
it('当前评价关系到期后拒绝；已有读取范围不能替代处理写权', async () => {
  const { f, gate, request } = await fixture();
  f.authority.context.account.personId = 'judge';
  f.authority.context.grants = [];
  f.authority.context.evaluationRelations = [
    {
      id: 'relation-a',
      evaluationNodeId: 'node-a',
      personId: 'demo-a',
      evaluatorId: 'judge',
      kind: 'judge',
      validFrom: '2026-01-01',
      validTo: '2026-09-05',
      revokedAt: null,
    },
  ];
  expect((await gate.parse('account-a', request)).status).toBe('needs_review');
  f.sent = [];
  f.authority.context.evaluationRelations[0]!.validTo =
    '2026-09-04T00:00:00.000Z';
  expect((await gate.parse('account-a', request)).status).toBe('forbidden');
  expect(f.sent).toEqual([]);
});

it('来源不存在、读取失败和大小超预算均不外发；取消信号在裁后仍生效', async () => {
  const a = await fixture();
  a.deps.loadCurrent = async () => null;
  expect(
    await createImageDisclosureGate(a.deps).parse('account-a', a.request),
  ).toMatchObject({ status: 'not_found' });
  expect(a.f.reads).toBe(0);
  const b = await fixture();
  b.deps.readOriginal = async () => {
    throw new Error('read unavailable');
  };
  await expect(
    createImageDisclosureGate(b.deps).parse('account-a', b.request),
  ).rejects.toThrow('read unavailable');
  expect(b.f.sent).toEqual([]);
  const c = await fixture();
  c.deps.limits.maxInputBytes = c.f.bytes.length - 1;
  expect(
    await createImageDisclosureGate(c.deps).parse('account-a', c.request),
  ).toMatchObject({ status: 'failed', code: 'resource_limit' });
  expect(c.f.reads).toBe(0);
  const d = await fixture(),
    abort = new AbortController(),
    load = d.deps.loadCurrent;
  d.deps.loadCurrent = async (...args) => {
    const v = await load(...args);
    if (d.f.loads === 3) abort.abort();
    return v;
  };
  expect(
    await createImageDisclosureGate(d.deps).parse(
      'account-a',
      d.request,
      abort.signal,
    ),
  ).toMatchObject({ status: 'cancelled' });
  expect(d.f.sent).toEqual([]);
});
it('真实Modelink契约拒绝非法枚举；被绕过的供应商校验仍在门禁处拒绝额外身份字段', async () => {
  const a = await fixture();
  a.f.output.legibility = 'made-up';
  expect(await a.gate.parse('account-a', a.request)).toMatchObject({
    status: 'failed',
    code: 'model_invalid_response',
  });
  const b = await fixture();
  b.deps.client = {
    async generateStructured(input) {
      const value = await createFakeModelinkMaas(b.f.output).generateStructured(
        input,
      );
      if (value.ok) Object.assign(value.value, { personId: 'forged' });
      return value;
    },
  };
  expect(
    await createImageDisclosureGate(b.deps).parse('account-a', b.request),
  ).toMatchObject({ status: 'failed', code: 'invalid_response' });
});
it('PNG像素损坏但原件摘要与版本自洽时，解码失败仍保证零模型调用', async () => {
  const { f, gate, request } = await fixture();
  f.bytes = Buffer.from(f.bytes);
  let p = 8;
  while (f.bytes.toString('ascii', p + 4, p + 8) !== 'IDAT')
    p += 12 + f.bytes.readUInt32BE(p);
  f.bytes[p + 8] = f.bytes[p + 8]! ^ 255;
  f.facts.sha256 = createHash('sha256').update(f.bytes).digest('hex');
  if (f.facts.scope.state === 'verified') f.facts.scope.sha256 = f.facts.sha256;
  expect(await gate.parse('account-a', request)).toMatchObject({
    status: 'failed',
    code: 'invalid_content',
  });
  expect(f.sent).toEqual([]);
});
