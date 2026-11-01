import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  materialSourceSchema,
  type MaterialSource,
} from '../../../../contracts/sources';
import type { DbExecutor, Transaction } from '../../../db/client';
import { jobSnapshots } from '../../../jobs/schema';
import {
  fragments,
  materialParses,
  materialPdfPages,
  originals,
  originalVersions,
} from '../schema';
import { parseCanonicalLocation } from './location-codec';
import { projectPdfParse } from './projection';

const id = z.string().min(1).regex(/\S/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const publicationSchema = z.strictObject({
  binding: z.strictObject({
    parseVersionId: id,
    originalVersionId: id,
    contentDigest: digest,
    parserVersion: id,
    projectionVersion: id,
  }),
  fragments: z.array(materialSourceSchema).min(1),
  pages: z.array(
    z.strictObject({ page: z.number().int().positive(), text: z.string() }),
  ),
});
const fenceSchema = z.strictObject({
  jobId: id,
  attempt: z.number().int().positive(),
  expectedRevision: z.number().int().positive(),
  inputVersion: id,
});
export type MaterialWriteFence = z.infer<typeof fenceSchema>;
export type MaterialParsePublication = ReturnType<typeof prepareMaterialParse>;
export class MaterialStoreError extends Error {
  constructor(
    readonly code:
      'invalid_material_parse' | 'material_conflict' | 'storage_unavailable',
  ) {
    super(code);
    this.name = 'MaterialStoreError';
  }
}
function safeStorageError(error: unknown): MaterialStoreError {
  if (error instanceof MaterialStoreError) return error;
  // The PostgreSQL driver may put quotes and identifiers in message/detail.
  const code =
    error && typeof error === 'object' && 'code' in error
      ? error.code
      : undefined;
  return new MaterialStoreError(
    code === '23505' || code === '23503' || code === '23514'
      ? 'material_conflict'
      : 'storage_unavailable',
  );
}

/** Normalize server-produced facts; this grants no write or read permission. */
export function prepareMaterialParse(input: unknown) {
  try {
    const parsed = publicationSchema.parse(input);
    const ids = new Set<string>();
    for (const fragment of parsed.fragments) {
      if (
        fragment.originalVersionId !== parsed.binding.originalVersionId ||
        ids.has(fragment.fragmentId)
      )
        throw new Error();
      ids.add(fragment.fragmentId);
      parseCanonicalLocation(fragment.location);
    }
    const pdf = parsed.fragments.filter(
      (fragment) => fragment.location.kind === 'pdf',
    );
    const pages = pdf.length
      ? projectPdfParse({ ...parsed, fragments: pdf }, parsed.binding).pages
      : [];
    if (!pdf.length && parsed.pages.length) throw new Error();
    const facts = {
      binding: parsed.binding,
      pages,
      fragments: parsed.fragments.sort((a, b) =>
        a.fragmentId < b.fragmentId ? -1 : a.fragmentId > b.fragmentId ? 1 : 0,
      ),
    };
    const resultDigest = createHash('sha256')
      .update(JSON.stringify(['material-parse-bundle-v1', facts]))
      .digest('hex');
    return { ...facts, resultDigest };
  } catch {
    throw new MaterialStoreError('invalid_material_parse');
  }
}
function source(row: typeof fragments.$inferSelect): MaterialSource {
  const base = {
    fragmentId: row.id,
    originalVersionId: row.originalVersionId,
    location: row.location,
    excerpt: row.excerpt,
    demo: row.demo,
    sourceCategory: row.sourceCategory,
  };
  if (
    (row.sourceCategory === 'historical_evaluation') !==
    (row.evaluationKind === 'interview')
  )
    throw new MaterialStoreError('material_conflict');
  return materialSourceSchema.parse({
    ...base,
    ...(row.sourceCategory === 'historical_evaluation'
      ? { evaluationKind: row.evaluationKind }
      : {}),
    ...(row.sourceCategory === 'submitted_code_snapshot'
      ? { displayNotice: '提交的代码快照' }
      : {}),
  });
}
async function original(tx: DbExecutor, versionId: string) {
  const [row] = await tx
    .select({
      contentDigest: originalVersions.contentDigest,
      kind: originals.kind,
    })
    .from(originalVersions)
    .innerJoin(originals, eq(originals.id, originalVersions.originalId))
    .where(eq(originalVersions.id, versionId));
  if (!row || row.kind !== 'original')
    throw new MaterialStoreError('material_conflict');
  return row;
}

/** Internal complete parse read. Call only inside the caller's consistent snapshot;
 * no rows here are an authorized web/model response. */
export async function readMaterialParse(
  tx: DbExecutor,
  parseVersionId: string,
) {
  try {
    if (!id.safeParse(parseVersionId).success)
      throw new MaterialStoreError('invalid_material_parse');
    const [parse] = await tx
      .select()
      .from(materialParses)
      .where(eq(materialParses.id, parseVersionId));
    if (!parse) return null;
    const version = await original(tx, parse.originalVersionId);
    if (version.contentDigest !== parse.contentDigest)
      throw new MaterialStoreError('material_conflict');
    const storedPages = await tx
      .select()
      .from(materialPdfPages)
      .where(eq(materialPdfPages.parseVersionId, parseVersionId));
    const rows = await tx
      .select()
      .from(fragments)
      .where(eq(fragments.parseVersionId, parseVersionId));
    const facts = prepareMaterialParse({
      binding: {
        parseVersionId: parse.id,
        originalVersionId: parse.originalVersionId,
        contentDigest: parse.contentDigest,
        parserVersion: parse.parserVersion,
        projectionVersion: parse.projectionVersion,
      },
      pages: storedPages.map(({ page, text }) => ({ page, text })),
      fragments: rows.map(source),
    });
    if (
      facts.resultDigest !== parse.resultDigest ||
      storedPages.some(
        (page) =>
          facts.pages.find((p) => p.page === page.page)?.textDigest !==
          page.textDigest,
      )
    )
      throw new MaterialStoreError('material_conflict');
    return { ...facts, jobId: parse.jobId, attempt: parse.attempt };
  } catch (error) {
    throw safeStorageError(error);
  }
}

/** Same real Transaction as commitJobUpdate and the first arrange enqueue. Caller
 * supplies already-authorized producer facts. No transaction, job copy or queue is
 * created here. The extra row fence prevents independent stale publication. */
export async function writeMaterialParse(
  tx: Transaction,
  input: unknown,
  fenceInput: unknown,
): Promise<'created' | 'existing'> {
  const facts = prepareMaterialParse(input);
  const checked = fenceSchema.safeParse(fenceInput);
  if (!checked.success) throw new MaterialStoreError('invalid_material_parse');
  const fence = checked.data;
  try {
    const [job] = await tx
      .select()
      .from(jobSnapshots)
      .where(eq(jobSnapshots.jobId, fence.jobId))
      .for('update');
    if (
      !job ||
      job.attempt !== fence.attempt ||
      job.revision !== fence.expectedRevision ||
      job.inputVersion !== fence.inputVersion ||
      job.cancelRequestedAt !== null ||
      !['running', 'partial', 'completed'].includes(job.status)
    )
      throw new MaterialStoreError('material_conflict');
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`material-parse:${facts.binding.parseVersionId}`}, 0))`,
    );
    const version = await original(tx, facts.binding.originalVersionId);
    if (version.contentDigest !== facts.binding.contentDigest)
      throw new MaterialStoreError('material_conflict');
    const existing = await readMaterialParse(tx, facts.binding.parseVersionId);
    if (existing) {
      if (
        JSON.stringify(existing) !==
        JSON.stringify({ ...facts, jobId: fence.jobId, attempt: fence.attempt })
      )
        throw new MaterialStoreError('material_conflict');
      return 'existing';
    }
    if (job.status === 'completed')
      throw new MaterialStoreError('material_conflict');
    await tx.insert(materialParses).values({
      id: facts.binding.parseVersionId,
      originalVersionId: facts.binding.originalVersionId,
      contentDigest: facts.binding.contentDigest,
      parserVersion: facts.binding.parserVersion,
      projectionVersion: facts.binding.projectionVersion,
      resultDigest: facts.resultDigest,
      jobId: fence.jobId,
      attempt: fence.attempt,
    });
    if (facts.pages.length)
      await tx.insert(materialPdfPages).values(
        facts.pages.map((page) => ({
          ...page,
          parseVersionId: facts.binding.parseVersionId,
        })),
      );
    await tx.insert(fragments).values(
      facts.fragments.map((fragment) => ({
        id: fragment.fragmentId,
        originalVersionId: fragment.originalVersionId,
        parseVersionId: facts.binding.parseVersionId,
        sourceCategory: fragment.sourceCategory,
        evaluationKind:
          fragment.sourceCategory === 'historical_evaluation'
            ? fragment.evaluationKind
            : null,
        demo: fragment.demo,
        location: fragment.location,
        excerpt: fragment.excerpt,
      })),
    );
    return 'created';
  } catch (error) {
    throw safeStorageError(error);
  }
}

/** Resolve the server's reference, then verify the complete immutable parse, not
 * a client locator. Authorization must precede returning this private result. */
export async function readMaterialFragment(
  tx: DbExecutor,
  fragmentId: string,
  originalVersionId: string,
) {
  try {
    if (
      !id.safeParse(fragmentId).success ||
      !id.safeParse(originalVersionId).success
    )
      throw new MaterialStoreError('invalid_material_parse');
    const [row] = await tx
      .select()
      .from(fragments)
      .where(
        and(
          eq(fragments.id, fragmentId),
          eq(fragments.originalVersionId, originalVersionId),
        ),
      );
    if (!row) return null;
    // Legacy fragments stay on the old reader. Never infer missing provenance.
    if (!row.parseVersionId) throw new MaterialStoreError('material_conflict');
    const parse = await readMaterialParse(tx, row.parseVersionId);
    const fragment = parse?.fragments.find(
      (fragment) =>
        fragment.fragmentId === fragmentId &&
        fragment.originalVersionId === originalVersionId,
    );
    if (!parse || !fragment) throw new MaterialStoreError('material_conflict');
    return {
      source: fragment,
      binding: parse.binding,
      resultDigest: parse.resultDigest,
    };
  } catch (error) {
    throw safeStorageError(error);
  }
}
