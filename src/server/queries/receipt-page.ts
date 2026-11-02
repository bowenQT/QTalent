import 'server-only';
import { asc, eq, inArray } from 'drizzle-orm';
import { unstable_rethrow } from 'next/navigation';
import type { MaterialBatchReceipt } from '../../contracts/materials';
import { createClock } from '../../lib/clock';
import { requireSession } from '../auth/next';
import {
  canConfirmOwnNodeScore,
  eligibleNodeEvaluatorRelations,
} from '../authz/evaluation-node';
import { getDatabase, type Database } from '../db/client';
import { getEnv } from '../env';
import { jobAccount, sessionLost } from '../jobs/request';
import { accountBindings, organizations, people } from '../modules/directory';
import { readTalentEvaluationRules } from '../modules/evaluation-system';
import { evaluationNodes } from '../modules/programs';
import { arrangeInputs } from '../modules/records';
import { projects } from '../modules/staffing';
import { loadEvaluationContext } from '../usecases/evaluation-context';
import { readRecordMaterialBatchForCurrentUser } from './record-arrange';

export type ReceiptPagePerson = {
  name: string;
  hue: number;
  photo: string | null;
  meta: string;
  demo: boolean;
};
/** Same shape as the receipt page's `ReceiptView`; the page checks it at binding. */
export type ReceiptPageView = {
  receipt: MaterialBatchReceipt;
  title: string;
  entry: 'web';
  tool: null;
  original: string | null;
  submittedBy: string;
  submittedAt: string;
  people: Record<string, ReceiptPagePerson>;
  dimensions: Record<string, string>;
  confirmers: Record<string, { mine: boolean; name: string }>;
};
export type ReceiptPageResult =
  | { status: 'success'; view: ReceiptPageView; viewerName: string }
  | { status: 'forbidden' | 'not_found'; message: string }
  | { status: 'unavailable' };

const NOT_FOUND = '回执不存在，或者已不在你的查看范围里';

/**
 * The receipt page read (`/receipt?id=…`). What the account may see of the batch is the
 * 897 batch read's answer (BOW-845); this only adds what the page shows next to it:
 * a title from the node and project, who handed it in and when, names of the people
 * and dimensions the receipt already shows, and for each draft whether the viewer
 * may confirm it. That last one is the save's own rule (`canConfirmOwnNodeScore` for
 * every person) used as an entry hint; the save checks again.
 */
export async function readReceiptForCurrentUser(
  input: unknown,
): Promise<ReceiptPageResult> {
  try {
    const read = await readRecordMaterialBatchForCurrentUser(input);
    if (read.status === 'forbidden')
      return { status: 'forbidden', message: read.message };
    if (read.status === 'not_found' || read.status === 'validation_error')
      return { status: 'not_found', message: NOT_FOUND };
    if (read.status !== 'success') return { status: 'unavailable' };
    const session = await requireSession();
    const now = createClock(getEnv().APP_ENV).now().toISOString();
    return {
      status: 'success',
      ...(await readReceiptView(
        getDatabase(),
        session.user.id,
        now,
        read.result,
      )),
    };
  } catch (error) {
    // Sign-in redirects pass through; a failed read is stated as such on the page.
    unstable_rethrow(error);
    return { status: 'unavailable' };
  }
}

export type ReceiptRouteResult =
  ReceiptPageResult | { status: 'unauthenticated' };

/**
 * The receipt read behind the GET route (`/api/receipt/<batchId>`). It first checks the
 * request's access identity and session the way `/api/jobs` does, and answers
 * `unauthenticated` instead of redirecting to the login page; then it is the same read
 * as the page's. A session that ends while the read runs is also `unauthenticated`,
 * not a failed read. Dependency failures throw; the route answers 503.
 */
export async function readReceiptForRequest(
  headers: Headers,
  input: unknown,
): Promise<ReceiptRouteResult> {
  if (!(await jobAccount(headers))) return { status: 'unauthenticated' };
  try {
    const result = await readReceiptForCurrentUser(input);
    if (result.status === 'unavailable' && (await sessionLost(headers)))
      return { status: 'unauthenticated' };
    return result;
  } catch (error) {
    if (await sessionLost(headers, error)) return { status: 'unauthenticated' };
    throw error;
  }
}

/** Display facts for an already authorized receipt, in one read-only snapshot. */
export async function readReceiptView(
  db: Database,
  accountId: string,
  now: string,
  receipt: MaterialBatchReceipt,
): Promise<{ view: ReceiptPageView; viewerName: string }> {
  return db.transaction(
    async (tx) => {
      const { context } = await loadEvaluationContext(tx, accountId, now);
      const drafts = receipt.draftSet?.drafts ?? [];
      const [input] = await tx
        .select({
          creator: arrangeInputs.creatorAccountId,
          createdAt: arrangeInputs.createdAt,
          originalInput: arrangeInputs.originalInput,
        })
        .from(arrangeInputs)
        .where(eq(arrangeInputs.batchId, receipt.batchId))
        .orderBy(asc(arrangeInputs.createdAt))
        .limit(1);
      const accounts = [accountId, ...(input ? [input.creator] : [])];
      const bindings = await tx
        .select({
          accountId: accountBindings.accountId,
          personId: accountBindings.personId,
        })
        .from(accountBindings)
        .where(inArray(accountBindings.accountId, accounts));
      const personOf = new Map(bindings.map((b) => [b.accountId, b.personId]));

      const confirmerIds = new Map<string, string[]>();
      const confirmable = new Map<string, boolean>();
      for (const draft of drafts) {
        confirmable.set(
          draft.draftId,
          draft.personIds.every((personId) =>
            canConfirmOwnNodeScore(context, {
              evaluationNodeId: draft.evaluationNodeId,
              personId,
              raterId: context.account.personId,
            }),
          ),
        );
        // Names only where the viewer may already see the assignment (HR).
        confirmerIds.set(draft.draftId, [
          ...new Set(
            draft.personIds.flatMap((personId) =>
              eligibleNodeEvaluatorRelations(
                context,
                draft.evaluationNodeId,
                personId,
              ).map((relation) => relation.evaluatorId),
            ),
          ),
        ]);
      }
      const ids = [
        ...new Set([
          ...receipt.personIds,
          ...bindings.map((b) => b.personId),
          ...[...confirmerIds.values()].flat(),
        ]),
      ];
      const rows = ids.length
        ? await tx
            .select({
              id: people.id,
              name: people.name,
              hue: people.hue,
              photo: people.photo,
              meta: organizations.shortName,
              demo: people.demo,
            })
            .from(people)
            .innerJoin(
              organizations,
              eq(organizations.id, people.organizationId),
            )
            .where(inArray(people.id, ids))
        : [];
      const byId = new Map(rows.map((row) => [row.id, row]));
      const nameOf = (personId: string | undefined) =>
        (personId && byId.get(personId)?.name) || '';

      const [node] = await tx
        .select({ name: evaluationNodes.name })
        .from(evaluationNodes)
        .where(eq(evaluationNodes.id, receipt.evaluationNodeId));
      const [project] = receipt.projectId
        ? await tx
            .select({ name: projects.name })
            .from(projects)
            .where(eq(projects.id, receipt.projectId))
        : [];
      const rules = await readTalentEvaluationRules(tx);

      const viewerName = nameOf(personOf.get(accountId));
      return {
        viewerName,
        view: {
          receipt,
          title:
            [project?.name, node?.name].filter(Boolean).join(' · ') || '回执',
          // Only the Web intake creates batches on main; WeCom and MCP channel
          // metadata arrive with their entries (#282, #280, #330).
          entry: 'web',
          tool: null,
          // The words the submitter wrote, only for the submitter: 897 lets only the
          // creator open a batch today, and nobody else's input is handed out here.
          original:
            receipt.textMaterial &&
            input?.creator === accountId &&
            'text' in input.originalInput
              ? input.originalInput.text
              : null,
          submittedBy: nameOf(input && personOf.get(input.creator)) || '提交人',
          submittedAt: new Date(input?.createdAt ?? now).toISOString(),
          people: Object.fromEntries(
            receipt.personIds.flatMap((personId) => {
              const row = byId.get(personId);
              return row
                ? [
                    [
                      personId,
                      {
                        name: row.name,
                        hue: row.hue,
                        photo: row.photo,
                        meta: row.meta,
                        demo: row.demo,
                      },
                    ],
                  ]
                : [];
            }),
          ),
          dimensions: Object.fromEntries(
            rules.dimensions.map((dimension) => [dimension.id, dimension.name]),
          ),
          confirmers: Object.fromEntries(
            drafts.map((draft) => {
              const mine = confirmable.get(draft.draftId) ?? false;
              const names = (confirmerIds.get(draft.draftId) ?? [])
                .map((id) => nameOf(id))
                .filter(Boolean);
              return [
                draft.draftId,
                {
                  mine,
                  name: mine ? viewerName : names.join('、') || '评价人',
                },
              ];
            }),
          ),
        },
      };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}
