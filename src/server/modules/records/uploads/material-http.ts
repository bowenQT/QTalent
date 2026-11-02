import {
  completeUploadResultSchema,
  materialRequestUploadResultSchema,
} from '../../../../contracts/media';
import {
  materialStagingCollectionInputSchema,
  materialStagingCollectionResultSchema,
} from '../../../../contracts/material-uploads';
import type { createRecordCollectionService } from './collections';
import { commandBody, failure, json } from './http';
import type { createUploadService } from './service';
import { UploadError } from './types';

/** Request→Response boundary for material intake into unassigned staging
 * collections: create the collection, request a direct-upload grant, complete.
 * Same-origin, session and bounded-JSON checks match the record upload routes.
 */
export function createMaterialUploadHttpHandlers(deps: {
  collections: ReturnType<typeof createRecordCollectionService>;
  service: ReturnType<typeof createUploadService>;
  trustedOrigin: string;
  authenticate(headers: Headers): Promise<string | null>;
}) {
  const origin = new URL(deps.trustedOrigin);
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username ||
    origin.password
  )
    throw new UploadError('unavailable', 'invalid_trusted_origin');
  const trustedOrigin = origin.origin;
  async function command(
    request: Request,
    run: (accountId: string, input: unknown) => Promise<unknown>,
  ) {
    let input: unknown = null;
    try {
      if (request.method !== 'POST')
        return new Response(null, { status: 405, headers: { allow: 'POST' } });
      if (request.headers.get('origin') !== trustedOrigin)
        throw new UploadError('forbidden', 'cross_origin');
      const accountId = await deps.authenticate(request.headers);
      if (!accountId)
        throw new UploadError('unauthenticated', 'authentication_required');
      input = await commandBody(request);
      return json(await run(accountId, input));
    } catch (error) {
      return failure(error, input);
    }
  }
  return {
    createCollection: (request: Request) =>
      command(request, async (accountId, input) => {
        const parsed = materialStagingCollectionInputSchema.safeParse(input);
        if (!parsed.success)
          throw new UploadError('validation_error', 'invalid_input');
        const collection = await deps.collections.create(accountId, {
          operationId: parsed.data.operationId,
          target: {
            kind: 'unassigned',
            evaluationNodeId: parsed.data.evaluationNodeId,
          },
        });
        return materialStagingCollectionResultSchema.parse({
          status: 'success',
          recordCollectionId: collection.id,
          expiresAt: new Date(collection.expiresAt).toISOString(),
        });
      }),
    requestUpload: (request: Request) =>
      command(request, async (accountId, input) =>
        materialRequestUploadResultSchema.parse(
          await deps.service.requestMaterial(accountId, input),
        ),
      ),
    completeUpload: (request: Request) =>
      command(request, async (accountId, input) =>
        completeUploadResultSchema.parse({
          status: 'success',
          result: await deps.service.complete(accountId, input),
        }),
      ),
  };
}
