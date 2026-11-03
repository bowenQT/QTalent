import { createHash, randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { expect } from 'vitest';
import type { Database } from '../../../src/server/db/client';
import { createTestKodo } from '../../../src/server/integrations/kodo/test-kodo';
import { createMaterialUploadRuntime } from '../../../src/server/queries/material-upload-runtime';
import {
  recordSaveInputSchema,
  type RecordBatchDraft,
} from '../../../src/contracts/record';
import { businessAt } from '../../fixtures/bow-845/native';

const origin = 'http://127.0.0.1:3000';

/** Only the external Kodo boundary is synthetic. Collections, grants, archive
 * completion and authorization use the production runtime and real SQL. */
export async function stagedMaterialUploads(
  db: Database,
  testDatabaseUrl: string,
) {
  // Same DB-scoped directory the existing testKodoFor uses in another process.
  const directory = join(
    tmpdir(),
    'qtalent-test-kodo',
    createHash('sha256').update(testDatabaseUrl).digest('hex').slice(0, 16),
  );
  const kodo = createTestKodo(`${origin}/api/test/kodo`, directory);
  const runtime = createMaterialUploadRuntime({
    db,
    storage: kodo.storage,
    trustedOrigin: origin,
    businessNow: () => businessAt,
  });
  return {
    runtime,
    storage: kodo.storage,
    close: () => rm(directory, { recursive: true, force: true }),
    async upload(input: {
      accountId: string;
      evaluationNodeId: string;
      filename: string;
      mediaType: string;
      bytes: Uint8Array;
    }) {
      const target = {
        kind: 'unassigned' as const,
        evaluationNodeId: input.evaluationNodeId,
      };
      const collection = await runtime.collections.create(input.accountId, {
        operationId: randomUUID(),
        target,
      });
      const requested = await runtime.service.requestMaterial(input.accountId, {
        purpose: 'attachment',
        recordCollectionId: collection.id,
        filename: input.filename,
        declaredMediaType: input.mediaType,
        declaredBytes: input.bytes.length,
        target,
        operationId: randomUUID(),
      });
      expect(requested.status).toBe('success');
      if (requested.status !== 'success')
        throw new Error('Upload grant rejected');
      const grant = requested.upload;
      const path = [
        'buckets',
        'test-bucket',
        'objects',
        Buffer.from(grant.objectKey)
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_'),
        'uploads',
      ];
      const headers = { authorization: `UpToken ${grant.uploadToken}` };
      const request = (method: string, body?: BodyInit) =>
        new Request(`${origin}/api/test/kodo`, { method, headers, body });
      const initiated = await kodo.handle(request('POST'), path);
      expect(initiated.status).toBe(200);
      const multipart = z
        .object({ uploadId: z.string() })
        .parse(await initiated.json());
      const part = await kodo.handle(
        request('PUT', new Uint8Array(input.bytes)),
        [...path, multipart.uploadId, '1'],
      );
      expect(part.status).toBe(200);
      const { etag } = z.object({ etag: z.string() }).parse(await part.json());
      const completed = await kodo.handle(
        request(
          'POST',
          JSON.stringify({
            parts: [{ partNumber: 1, etag }],
            mimeType: input.mediaType,
          }),
        ),
        [...path, multipart.uploadId],
      );
      expect(completed.status).toBe(200);
      const command = {
        uploadId: grant.uploadId,
        operationId: randomUUID(),
        receiptRef: 'synthetic-kodo-receipt',
        expectedRevision: grant.revision,
      };
      const archived = await runtime.service.complete(input.accountId, command);
      expect(archived).toHaveProperty('status', 'staged');
      return { archived, grant, command, collection };
    },
  };
}

export function confirmBusinessDraft(draft: RecordBatchDraft) {
  return recordSaveInputSchema.parse({
    operation_id: randomUUID(),
    expected_revision: draft.revision,
    draftId: draft.draftId,
    personIds: draft.personIds,
    projectId: draft.projectId,
    sbi: draft.sbi,
    decisions: draft.scores.map((score) => ({
      personId: score.personId,
      dimensionId: score.dimensionId,
      action: 'confirm',
    })),
  });
}

/** The production demo importer parses pinned synthetic PDFs; the test seeds
 * only current directory/authorization facts, not parsed or archived successes. */
export async function seedInterviewBusinessCase(db: Database) {
  const { readFile } = await import('node:fs/promises');
  const { organizations, people, accountBindings, grants, employments } =
    await import('../../../src/server/modules/directory');
  const { cohorts, enrollments, evaluationRelations } =
    await import('../../../src/server/modules/programs');
  const { importInterviewImportDemo, INTERVIEW_IMPORT_DEMO } =
    await import('../../../src/server/db/seed/interview-import-demo/import');
  const directory = z
    .object({
      demo: z.literal(true),
      people: z.array(
        z.object({ id: z.string(), name: z.string(), demo: z.literal(true) }),
      ),
    })
    .parse(
      JSON.parse(
        await readFile('tests/fixtures/bow-896/directory.json', 'utf8'),
      ),
    );
  const organizationId = 'c904-interview-org';
  const cohortId = 'c904-interview-cohort';
  const hr = 'c904-hr';
  const evaluator = 'c904-evaluator';
  const employee = 'c904-employee';
  const hrGrantId = 'c904-hr-grant';
  await db
    .insert(organizations)
    .values({ id: organizationId, name: '演示回归组织', shortName: '演示' });
  await db
    .insert(people)
    .values(directory.people.map((person) => ({ ...person, organizationId })));
  await db.insert(accountBindings).values([
    { accountId: hr, personId: 'p-suwan' },
    { accountId: evaluator, personId: 'p-yeqing' },
    { accountId: employee, personId: 'p-x08' },
  ]);
  await db.insert(cohorts).values({ id: cohortId, name: '演示回归期次' });
  await db.insert(grants).values({
    id: hrGrantId,
    accountId: hr,
    role: 'hr',
    scope: 'cohort',
    cohortId,
    validFrom: '2026-01-01',
  });
  await db.insert(enrollments).values({
    id: 'c904-interview-enrollment',
    personId: 'p-x08',
    cohortId,
    confirmed: true,
    validFrom: '2026-01-01',
  });
  await db.insert(employments).values({
    id: 'c904-interview-employment',
    personId: 'p-x08',
    organizationId,
    validFrom: '2025-01-01',
  });
  const imported = await importInterviewImportDemo(db, process.cwd());
  expect(imported.status).toBe('created');
  await db.insert(evaluationRelations).values({
    id: 'c904-interview-evaluator-relation',
    evaluationNodeId: INTERVIEW_IMPORT_DEMO.node.id,
    personId: 'p-x08',
    evaluatorId: 'p-yeqing',
    kind: 'evaluator',
    validFrom: '2026-01-01T00:00:00Z',
  });
  return {
    hr,
    evaluator,
    employee,
    hrGrantId,
    personId: 'p-x08',
    batchId: INTERVIEW_IMPORT_DEMO.batchId,
    rowId: 'campus-1',
  };
}

/** EXPLICIT synthetic pre-existing capture fixture, NOT a capture API. Current
 * staged uploads have no capture writer. This models the already-registered,
 * fully known source prerequisite solely for the downstream worker regression. */
export async function seedAlreadyCapturedAttachmentScope(
  db: Database,
  input: {
    materialId: string;
    accountId: string;
    personId: string;
    nodeId: string;
    cohortId: string;
  },
) {
  const { eq } = await import('drizzle-orm');
  const { mediaMaterials } =
    await import('../../../src/server/modules/records/material-review/schema');
  const { recordAudit } = await import('../../../src/server/platform/audit');
  await db.transaction(async (tx) => {
    const scopeAuditId = await recordAudit(tx, {
      actorId: input.accountId,
      action: 'material.capture',
      resourceId: input.materialId,
    });
    const updated = await tx
      .update(mediaMaterials)
      .set({
        intakeScope: {
          subjects: [
            {
              personId: input.personId,
              evaluationNodeId: input.nodeId,
              cohortId: input.cohortId,
            },
          ],
          kind: 'evaluation',
          requiredKinds: [],
          occurredOn: businessAt.slice(0, 10),
        },
        scopeAuditId,
      })
      .where(eq(mediaMaterials.id, input.materialId))
      .returning();
    expect(updated).toHaveLength(1);
  });
}
