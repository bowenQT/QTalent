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
import type { DefaultIntakeNode } from './default-node';
import type { createUploadService } from './service';
import { UploadError } from './types';

const defaultNodeMessages = {
  default_node_missing: '你当前没有可以接收材料的评价节点',
  default_node_ambiguous:
    '你同时负责多个评价节点，暂时无法确定材料投递到哪一个',
} as const;

/** Request→Response boundary for material intake into unassigned staging
 * collections: create the collection, request a direct-upload grant, complete.
 * Same-origin, session and bounded-JSON checks match the record upload routes.
 */
export function createMaterialUploadHttpHandlers(deps: {
  collections: ReturnType<typeof createRecordCollectionService>;
  service: ReturnType<typeof createUploadService>;
  trustedOrigin: string;
  authenticate(headers: Headers): Promise<string | null>;
  defaultNode(accountId: string): Promise<DefaultIntakeNode>;
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
    run: (accountId: string, input: unknown) => Promise<unknown | Response>,
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
      const result = await run(accountId, input);
      return result instanceof Response ? result : json(result);
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
        const node = await deps.defaultNode(accountId);
        if (node.status !== 'resolved')
          return json(
            materialStagingCollectionResultSchema.parse({
              status: node.status,
              message: defaultNodeMessages[node.status],
            }),
            409,
          );
        const collection = await deps.collections.create(accountId, {
          operationId: parsed.data.operationId,
          target: {
            kind: 'unassigned',
            evaluationNodeId: node.evaluationNodeId,
          },
        });
        return materialStagingCollectionResultSchema.parse({
          status: 'success',
          recordCollectionId: collection.id,
          evaluationNodeId: node.evaluationNodeId,
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
