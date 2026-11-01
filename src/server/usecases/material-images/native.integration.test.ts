import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { nativeDatabase } from '../../../../tests/fixtures/bow-845/native';
import { createClock } from '../../../lib/clock';
import { createFakeModelinkMaas } from '../../integrations/maas/modelink';
import { accountBindings } from '../../modules/directory';
import {
  evaluationRelations,
  evaluationNodeSubjects,
  enrollments,
} from '../../modules/programs';
import { jobSnapshots } from '../../jobs/schema';
import { originals, originalVersions } from '../../modules/records/schema';
import {
  uploadIntents,
  uploadObjects,
} from '../../modules/records/uploads/schema';
import {
  mediaMaterials,
  mediaReviewItems,
  mediaReviewOperations,
} from '../../modules/records/material-review/schema';
import { arrangeInputs } from '../../modules/records/arrange/input-state/schema';
import { recordAudit } from '../../platform/audit';
import {
  materialReviewCommandSchema,
  materialReviewResolutionReceiptSchema,
} from '../../../contracts/material-review';
import type { ImageGateDependencies } from './policy';
import { createNativeInitialImageGate } from './native';
import { seedImageCase } from './native.fixture';
import * as crop from './crop';

let c: Awaited<ReturnType<typeof nativeDatabase>>;
beforeAll(async () => {
  c = await nativeDatabase();
}, 30000);
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await c?.close();
});
type F = Awaited<ReturnType<typeof seedImageCase>>;
const at = '2026-11-01T12:00:00.000Z';

function harness(
  f: F,
  hooks: {
    read?: () => Promise<void>;
    model?: () => Promise<void>;
    bytes?: Buffer;
  } = {},
) {
  let reads = 0;
  const sent: string[] = [];
  const dependencies: Omit<ImageGateDependencies, 'loadCurrent'> = {
    clock: createClock('production', () => new Date(at)),
    limits: {
      maxInputBytes: 1024 * 1024,
      maxWidth: 100,
      maxHeight: 100,
      maxPixels: 10000,
      maxDecodedBytes: 40000,
      maxOutputBytes: 1024 * 1024,
      processingSeconds: 2,
      maxElapsedMs: 6000,
    },
    // Explicit object-storage boundary fixture: permissions are NOT supplied here.
    async readOriginal(facts, options) {
      reads++;
      expect(facts.originalVersionId).toBe(f.row.originalVersionId);
      expect(facts.source).toBeNull();
      expect(f.bytes.length).toBeLessThan(options.maxBytes);
      await hooks.read?.();
      return hooks.bytes ?? f.bytes;
    },
    client: {
      async generateStructured(input) {
        for (const message of input.messages)
          if (Array.isArray(message.content))
            for (const part of message.content)
              if (part.type === 'image_url') sent.push(part.image_url.url);
        await hooks.model?.();
        return createFakeModelinkMaas({
          text: '演示：补齐回滚步骤。',
          observedNames: [],
          legibility: 'readable',
        }).generateStructured(input);
      },
    },
  };
  const gate = createNativeInitialImageGate(c.db, dependencies);
  const request = {
    materialId: f.row.id,
    originalVersionId: f.row.originalVersionId,
    expectedRevision: 1,
  };
  return {
    dependencies,
    request,
    sent,
    reads: () => reads,
    run: () => gate.parse(f.account, request),
  };
}
async function revoke(f: F, relation = f.relation) {
  await c.db
    .update(evaluationRelations)
    .set({ revokedAt: '2026-11-01T11:59:00Z' })
    .where(eq(evaluationRelations.id, relation));
}
async function release(f: F) {
  await c.db
    .update(uploadIntents)
    .set({
      releasedAt: 300,
      releaseOperationId: randomUUID(),
      releaseFingerprint: 'e'.repeat(64),
      revision: 2,
    })
    .where(eq(uploadIntents.id, f.row.uploadId));
}
async function attachmentOnly(f: F) {
  const resolution = { action: 'keep_attachment_only' as const };
  await c.db
    .update(mediaReviewOperations)
    .set({
      command: materialReviewCommandSchema.parse({
        ...f.op.command,
        resolution,
      }),
      receipt: materialReviewResolutionReceiptSchema.parse({
        ...f.op.receipt,
        resolution,
        resume: null,
      }),
    })
    .where(eq(mediaReviewOperations.id, f.op.id));
}
async function addCoSubject(f: F) {
  await c.db
    .insert(evaluationNodeSubjects)
    .values({ evaluationNodeId: f.node, personId: f.other });
  await c.db.insert(enrollments).values({
    id: randomUUID(),
    personId: f.other,
    cohortId: f.cohort,
    confirmed: true,
    validFrom: '2026-01-01',
  });
  const relation = randomUUID();
  await c.db.insert(evaluationRelations).values({
    id: relation,
    evaluationNodeId: f.node,
    personId: f.other,
    evaluatorId: f.evaluator,
    kind: 'evaluator',
    validFrom: '2026-01-01T00:00:00Z',
  });
  const [row] = await c.db
    .select()
    .from(mediaMaterials)
    .where(eq(mediaMaterials.id, f.row.id));
  await c.db
    .update(mediaMaterials)
    .set({
      intakeScope: {
        ...row.intakeScope!,
        subjects: [
          ...row.intakeScope!.subjects,
          { personId: f.other, evaluationNodeId: f.node, cohortId: f.cohort },
        ],
      },
    })
    .where(eq(mediaMaterials.id, f.row.id));
  return relation;
}

it('wires the real SQL reader to real Sharp and sends only the approved pixels, preserving null canonical source', async () => {
  const f = await seedImageCase(c.db),
    h = harness(f);
  const result = await h.run();
  expect(result).toMatchObject({
    status: 'candidate',
    origin: 'ai_transcription',
    source: null,
    provenance: {
      originalVersionId: f.row.originalVersionId,
      pixelRegion: { left: 0, top: 0, width: 2, height: 2 },
    },
  });
  expect(h.reads()).toBe(1);
  expect(h.sent).toHaveLength(1);
  const png = Buffer.from(h.sent[0].split(',')[1], 'base64');
  const decoded = await sharp(png)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(decoded.info).toMatchObject({ width: 2, height: 2, channels: 3 });
  expect([...decoded.data]).toEqual(Array(4).fill([255, 0, 0]).flat());
  expect(png.equals(f.bytes)).toBe(false);
  expect(
    await c.db
      .select()
      .from(mediaReviewOperations)
      .where(eq(mediaReviewOperations.id, f.op.id)),
  ).toEqual([f.op]);
});

it.each(['scope', 'audit', 'batch', 'creator', 'project', 'digest'] as const)(
  'fails closed before object read/model when native %s facts are invalid',
  async (kind) => {
    const f = await seedImageCase(c.db),
      h = harness(f);
    if (kind === 'scope')
      await c.db
        .update(mediaMaterials)
        .set({ intakeScope: null, scopeAuditId: null })
        .where(eq(mediaMaterials.id, f.row.id));
    if (kind === 'audit') {
      const wrong = await recordAudit(c.db, {
        actorId: f.account,
        action: 'material.capture',
        resourceId: 'other-synthetic-material',
      });
      await c.db
        .update(mediaMaterials)
        .set({ scopeAuditId: wrong })
        .where(eq(mediaMaterials.id, f.row.id));
    }
    if (kind === 'batch')
      await c.db
        .update(arrangeInputs)
        .set({
          originalInput: {
            kind: 'media',
            operationId: f.row.inputId,
            materialIds: [f.row.id, 'unrelated-material'],
          },
        })
        .where(eq(arrangeInputs.id, f.row.inputId));
    if (kind === 'creator')
      await c.db
        .update(arrangeInputs)
        .set({ creatorAccountId: f.outsiderAccount })
        .where(eq(arrangeInputs.id, f.row.inputId));
    if (kind === 'project')
      await c.db
        .update(arrangeInputs)
        .set({
          projectMode: 'needs_selection',
          projectCandidateIds: ['unknown-project'],
        })
        .where(eq(arrangeInputs.id, f.row.inputId));
    if (kind === 'digest')
      await c.db
        .update(originalVersions)
        .set({ contentDigest: 'f'.repeat(64) })
        .where(eq(originalVersions.id, f.row.originalVersionId));
    expect(await h.run()).toEqual({ status: 'not_found' });
    expect(h.reads()).toBe(0);
    expect(h.sent).toHaveLength(0);
  },
);

it.each(['release', 'rebind', 'revoke', 'terminal'] as const)(
  'uses current native %s state before reading any bytes',
  async (kind) => {
    const f = await seedImageCase(c.db),
      h = harness(f);
    if (kind === 'release') await release(f);
    if (kind === 'rebind')
      await c.db
        .update(accountBindings)
        .set({ personId: f.other })
        .where(eq(accountBindings.accountId, f.account));
    if (kind === 'revoke') await revoke(f);
    if (kind === 'terminal')
      await c.db
        .update(jobSnapshots)
        .set({ status: 'completed' })
        .where(eq(jobSnapshots.jobId, f.row.inputId));
    expect(await h.run()).toEqual({ status: 'not_found' });
    expect(h.reads()).toBe(0);
    expect(h.sent).toHaveLength(0);
  },
);

it('retains a co-subject even when the crop decision names only one, and refuses after that co-subject loses permission', async () => {
  const f = await seedImageCase(c.db),
    relation = await addCoSubject(f);
  const h = harness(f);
  expect(await h.run()).toMatchObject({ status: 'candidate' });
  await revoke(f, relation);
  expect(await h.run()).toEqual({ status: 'not_found' });
  expect(h.reads()).toBe(1);
  expect(h.sent).toHaveLength(1);
});

it('includes another batch capture of the same original instead of treating this batch as the complete source', async () => {
  const f = await seedImageCase(c.db),
    h = harness(f);
  const [input] = await c.db
    .select()
    .from(arrangeInputs)
    .where(eq(arrangeInputs.id, f.row.inputId));
  const [job] = await c.db
    .select()
    .from(jobSnapshots)
    .where(eq(jobSnapshots.jobId, f.row.inputId));
  const otherInput = randomUUID(),
    otherMaterial = randomUUID();
  await c.db
    .insert(jobSnapshots)
    .values({ ...job, jobId: otherInput, resourceId: otherInput });
  await c.db.insert(arrangeInputs).values({
    ...input,
    id: otherInput,
    jobId: otherInput,
    batchId: otherInput,
    originalInput: {
      kind: 'media',
      operationId: otherInput,
      materialIds: [otherMaterial],
    },
  });
  const scopeAuditId = await recordAudit(c.db, {
    actorId: f.account,
    action: 'material.capture',
    resourceId: otherMaterial,
  });
  await c.db.insert(mediaMaterials).values({
    ...f.row,
    id: otherMaterial,
    inputId: otherInput,
    clientFileId: randomUUID(),
    scopeAuditId,
    intakeScope: {
      subjects: [
        {
          personId: f.other,
          evaluationNodeId: f.otherNode,
          cohortId: f.cohort,
        },
      ],
      kind: 'evaluation',
      requiredKinds: [],
      occurredOn: '2026-11-01',
    },
  });
  expect(await h.run()).toEqual({ status: 'not_found' });
  expect(h.reads()).toBe(0);
  expect(h.sent).toHaveLength(0);
});

it('rechecks source identity after object retrieval and before cropping', async () => {
  const f = await seedImageCase(c.db);
  const h = harness(f, {
    read: async () => {
      await c.db
        .update(originalVersions)
        .set({ contentDigest: 'b'.repeat(64) })
        .where(eq(originalVersions.id, f.row.originalVersionId));
    },
  });
  const realCrop = vi.spyOn(crop, 'cropMaterialImage');
  expect(await h.run()).toEqual({ status: 'not_found' });
  expect(realCrop).not.toHaveBeenCalled();
  expect(h.sent).toHaveLength(0);
});

it('rereads SQL after actual native cropping, so a committed source revision prevents external disclosure', async () => {
  const f = await seedImageCase(c.db),
    h = harness(f);
  const original = crop.cropMaterialImage;
  // Deterministic scheduling hook only: execute the real native crop, then commit
  // the concurrent SQL change. Neither bytes nor authorization are mocked.
  vi.spyOn(crop, 'cropMaterialImage').mockImplementation(async (...args) => {
    const result = await original(...args);
    await c.db
      .update(mediaMaterials)
      .set({ revision: 2 })
      .where(eq(mediaMaterials.id, f.row.id));
    return result;
  });
  expect(await h.run()).toEqual({ status: 'conflict' });
  expect(h.reads()).toBe(1);
  expect(h.sent).toHaveLength(0);
});

it('rejects permission revoked while awaiting the model response instead of returning a stale candidate', async () => {
  const f = await seedImageCase(c.db),
    h = harness(f, { model: () => revoke(f) });
  expect(await h.run()).toEqual({ status: 'not_found' });
  expect(h.sent).toHaveLength(1);
});

it('does not hold the reader transaction across byte retrieval or model I/O', async () => {
  const f = await seedImageCase(c.db);
  const acquire = () =>
    c.db.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '500ms'`);
      await tx
        .update(mediaMaterials)
        .set({ revision: 1 })
        .where(eq(mediaMaterials.id, f.row.id));
    });
  const h = harness(f, { read: acquire, model: acquire });
  expect(await h.run()).toMatchObject({ status: 'candidate' });
});

it('attachment-only uses the current real decision and performs zero object or model I/O', async () => {
  const f = await seedImageCase(c.db);
  await attachmentOnly(f);
  const h = harness(f);
  expect(await h.run()).toEqual({ status: 'attachment_only' });
  expect(h.reads()).toBe(0);
  expect(h.sent).toHaveLength(0);
});

it('a transition to attachment-only during object retrieval prevents the old crop from being sent', async () => {
  const f = await seedImageCase(c.db),
    h = harness(f, { read: () => attachmentOnly(f) });
  expect(await h.run()).toEqual({ status: 'conflict' });
  expect(h.sent).toHaveLength(0);
});

it('an undone current pointer cannot reuse the retained historical receipt to authorize disclosure', async () => {
  const f = await seedImageCase(c.db),
    h = harness(f);
  expect(await h.run()).toMatchObject({ status: 'candidate' });
  await c.db
    .update(mediaReviewItems)
    .set({ state: 'pending', revision: 3, currentOperationId: null })
    .where(eq(mediaReviewItems.id, f.question.itemId));
  expect(await h.run()).toEqual({ status: 'not_found' });
  expect(h.reads()).toBe(1);
  expect(h.sent).toHaveLength(1);
  expect(
    await c.db
      .select()
      .from(mediaReviewOperations)
      .where(eq(mediaReviewOperations.id, f.op.id)),
  ).toEqual([f.op]);
});

it('does not accept an object storage response with different bytes even when database permissions are current', async () => {
  const f = await seedImageCase(c.db),
    wrong = Buffer.from(f.bytes);
  wrong[wrong.length - 1] ^= 1;
  const h = harness(f, { bytes: wrong });
  expect(await h.run()).toMatchObject({ status: 'failed', code: 'conflict' });
  expect(h.sent).toHaveLength(0);
});

it('accepts the complete same-batch media set but refuses an omitted persisted member', async () => {
  const f = await seedImageCase(c.db),
    h = harness(f);
  const [intent] = await c.db
    .select()
    .from(uploadIntents)
    .where(eq(uploadIntents.id, f.row.uploadId));
  const [object] = await c.db
    .select()
    .from(uploadObjects)
    .where(eq(uploadObjects.originalVersionId, f.row.originalVersionId));
  const [version] = await c.db
    .select()
    .from(originalVersions)
    .where(eq(originalVersions.id, f.row.originalVersionId));
  const [material] = await c.db
    .select()
    .from(mediaMaterials)
    .where(eq(mediaMaterials.id, f.row.id));
  const nextOriginal = randomUUID(),
    nextVersion = randomUUID(),
    nextUpload = randomUUID(),
    nextMaterial = randomUUID();
  await c.db
    .insert(originals)
    .values({ id: nextOriginal, title: '演示第二原件', kind: 'original' });
  await c.db
    .insert(originalVersions)
    .values({ ...version, id: nextVersion, originalId: nextOriginal });
  await c.db.insert(uploadIntents).values({
    ...intent,
    id: nextUpload,
    operationId: randomUUID(),
    objectKey: nextOriginal,
    completionOperationId: randomUUID(),
    completed: {
      ...intent.completed!,
      uploadId: nextUpload,
      originalId: nextOriginal,
      originalVersionId: nextVersion,
    },
  });
  await c.db.insert(uploadObjects).values({
    ...object,
    uploadId: nextUpload,
    originalVersionId: nextVersion,
    objectKey: nextOriginal,
  });
  const scopeAuditId = await recordAudit(c.db, {
    actorId: f.account,
    action: 'material.capture',
    resourceId: nextMaterial,
  });
  await c.db.insert(mediaMaterials).values({
    ...material,
    id: nextMaterial,
    uploadId: nextUpload,
    originalVersionId: nextVersion,
    clientFileId: randomUUID(),
    scopeAuditId,
  });
  await c.db
    .update(arrangeInputs)
    .set({
      originalInput: {
        kind: 'media',
        operationId: f.row.inputId,
        materialIds: [f.row.id, nextMaterial],
      },
    })
    .where(eq(arrangeInputs.id, f.row.inputId));
  expect(await h.run()).toMatchObject({ status: 'candidate' });
  await c.db
    .update(arrangeInputs)
    .set({
      originalInput: {
        kind: 'media',
        operationId: f.row.inputId,
        materialIds: [f.row.id],
      },
    })
    .where(eq(arrangeInputs.id, f.row.inputId));
  expect(await h.run()).toEqual({ status: 'not_found' });
  expect(h.reads()).toBe(1);
  expect(h.sent).toHaveLength(1);
});
