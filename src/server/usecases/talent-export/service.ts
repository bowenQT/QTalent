import { isDeepStrictEqual } from 'node:util';
import { ForbiddenError } from '../project-context';
import { buildExportCsv, exportTimestamp } from './csv';
import {
  projectTalentExport,
  projectPersonExport,
  viewTalentExport,
} from './policy';
import {
  exportRequestSchema,
  personExportRequestSchema,
  TalentExportError,
  type ExportStore,
  type ExportRequest,
  type PersonExportRequest,
  type PreparedPersonExport,
  type ExportPhase,
  type ExportArtifact,
} from './types';
const normalized = (error: unknown) =>
  error instanceof TalentExportError
    ? error
    : error instanceof ForbiddenError
      ? new TalentExportError('forbidden')
      : new TalentExportError('unavailable');
export function createTalentExportService<C>(input: {
  store: ExportStore<C>;
  businessNow(): Date;
  wallNow(): Date;
}) {
  const { store } = input;
  for (const method of ['transaction', 'readSnapshot', 'audit'] as const)
    if (typeof store[method] !== 'function')
      throw new Error('Missing talent export port: ' + method);
  async function read(tx: C, accountId: string) {
    const now = input.businessNow().toISOString();
    const data = await store.readSnapshot(tx, accountId, now);
    if (
      data.context.account.id !== accountId ||
      data.context.now !== now ||
      data.directory.account.id !== accountId ||
      data.directory.account.personId !== data.context.account.personId
    )
      throw new TalentExportError('forbidden');
    return data;
  }
  async function guarded<T>(
    accountId: string,
    phase: ExportPhase,
    request: ExportRequest | PersonExportRequest | null,
    work: () => Promise<T>,
  ): Promise<T> {
    if (!accountId.trim()) throw new TalentExportError('unauthenticated');
    try {
      return await work();
    } catch (error) {
      const failure = normalized(error);
      try {
        await store.transaction((tx) =>
          store.audit(tx, {
            accountId,
            phase,
            request,
            outcome: failure.code === 'forbidden' ? 'denied' : 'failed',
          }),
        );
      } catch {
        throw new TalentExportError('audit_unavailable');
      }
      throw failure;
    }
  }
  async function render(
    accountId: string,
    raw: unknown,
    phase: 'generate' | 'download',
  ): Promise<ExportArtifact | null> {
    const parsed = exportRequestSchema.safeParse(raw);
    return guarded(
      accountId,
      phase,
      parsed.success ? parsed.data : null,
      async () => {
        if (!parsed.success) throw new TalentExportError('invalid_input');
        return store.transaction(async (tx) => {
          const projection = await projectTalentExport(
            await read(tx, accountId),
            parsed.data,
          );
          const file = projection.rows
            ? buildExportCsv(projection, input.wallNow())
            : null;
          await store.audit(tx, {
            accountId,
            phase,
            request: parsed.data,
            outcome: file ? 'success' : 'empty',
          });
          // Read Committed + a fresh clock: a changed grant, review, confirmation,
          // source or withdrawal must prevent the earlier bytes leaving the app.
          const current = await projectTalentExport(
            await read(tx, accountId),
            parsed.data,
          );
          if (!isDeepStrictEqual(projection, current))
            throw new TalentExportError('changed');
          return file ? { ...file, projection } : null;
        });
      },
    );
  }
  return {
    async view(accountId: string) {
      return guarded(accountId, 'preview', null, () =>
        store.transaction(async (tx) => {
          const first = await viewTalentExport(await read(tx, accountId));
          await store.audit(tx, {
            accountId,
            phase: 'preview',
            request: null,
            outcome: 'success',
          });
          const current = await viewTalentExport(await read(tx, accountId));
          if (!isDeepStrictEqual(first, current))
            throw new TalentExportError('changed');
          return current;
        }),
      );
    },
    async person(
      accountId: string,
      raw: unknown,
    ): Promise<PreparedPersonExport> {
      const parsed = personExportRequestSchema.safeParse(raw);
      return guarded(
        accountId,
        'print',
        parsed.success ? parsed.data : null,
        async () => {
          if (!parsed.success) throw new TalentExportError('invalid_input');
          return store.transaction(async (tx) => {
            const first = await projectPersonExport(
              await read(tx, accountId),
              parsed.data.personId,
            );
            const preparedAt = exportTimestamp(input.wallNow());
            await store.audit(tx, {
              accountId,
              phase: 'print',
              request: parsed.data,
              outcome: 'success',
            });
            const current = await projectPersonExport(
              await read(tx, accountId),
              parsed.data.personId,
            );
            if (!isDeepStrictEqual(first, current))
              throw new TalentExportError('changed');
            return {
              ...current,
              preparedAt,
              unavailableSections: [
                'adopted_summary',
                'formal_position',
                'job_level_tenure',
                'complete_hidden_content_hint',
              ],
            };
          });
        },
      );
    },
    generate(accountId: string, raw: unknown) {
      return render(accountId, raw, 'generate');
    },
    download(accountId: string, raw: unknown) {
      return render(accountId, raw, 'download');
    },
  };
}
