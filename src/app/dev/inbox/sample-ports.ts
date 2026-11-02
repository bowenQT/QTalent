import {
  materialReviewCommandResultSchema,
  materialReviewResolvedItemSchema,
  materialReviewUndoResultSchema,
  type MaterialReviewCommand,
  type MaterialReviewItem,
  type MaterialReviewResolvedItem,
} from '@/contracts/material-review';
import type { InboxData, InboxPorts } from '@/features/inbox/ports';

/**
 * In-memory ports for the development sample. They follow the 897 semantics the
 * page relies on (revision fence, defer stays unresolved, undo returns the item to
 * pending one revision later) and parse every result through the contract. They
 * are not a stand-in for the server's authorization or persistence.
 */
export function samplePorts(initial: InboxData): InboxPorts {
  let items: MaterialReviewItem[] = [...initial.items];
  let resolved: MaterialReviewResolvedItem[] = [...initial.resolvedItems];
  let audit = 0;
  const conflict = <T>(input: T) => ({
    status: 'conflict' as const,
    message: '修订已变化',
    input,
  });

  return {
    async read() {
      const order = (item: MaterialReviewItem) =>
        initial.items.findIndex((entry) => entry.itemId === item.itemId);
      return {
        items: [...items].sort((a, b) => order(a) - order(b)),
        resolvedItems: resolved,
        people: initial.people,
      };
    },
    async resolve(command: MaterialReviewCommand) {
      const item = items.find((entry) => entry.itemId === command.itemId);
      if (!item || item.kind !== command.kind)
        return { status: 'not_found', message: '没有这一处' };
      if (item.revision !== command.expectedRevision) return conflict(command);
      const revision = item.revision + 1;
      const { resolution } = command;
      if (resolution.action === 'defer') {
        items = items.map((entry) =>
          entry.itemId === item.itemId
            ? { ...entry, state: 'deferred', revision }
            : entry,
        );
      } else {
        items = items.filter((entry) => entry.itemId !== item.itemId);
        const { state: _state, ...rest } = item;
        void _state;
        const keep = Object.fromEntries(
          Object.entries(rest).filter(
            ([key]) =>
              ![
                'candidates',
                'recordingId',
                'transcriptVersionId',
                'speakerId',
                'proposedRegion',
              ].includes(key),
          ),
        );
        resolved = [
          ...resolved,
          materialReviewResolvedItemSchema.parse({
            ...keep,
            revision,
            state: 'resolved',
            resolvedAt: new Date().toISOString(),
            auditId: `sample-audit-${++audit}`,
            undo: { status: 'available' },
            resolution,
          }),
        ];
      }
      return materialReviewCommandResultSchema.parse({
        status: 'success',
        replayed: false,
        result: {
          kind: item.kind,
          batchId: item.batchId,
          materialId: item.materialId,
          itemId: item.itemId,
          revision,
          remainingReviewItemIds: items
            .filter((entry) => entry.batchId === item.batchId)
            .map((entry) => entry.itemId),
          blockingReviewItemIds: [],
          invalidatedDraftIds: [],
          resolution,
          resume: null,
        },
      });
    },
    async undo(command) {
      const done = resolved.find((entry) => entry.itemId === command.itemId);
      const original = initial.items.find(
        (entry) => entry.itemId === command.itemId,
      );
      if (!done || !original)
        return { status: 'not_found', message: '没有这一处' };
      if (
        done.revision !== command.expectedRevision ||
        done.undo.status !== 'available'
      )
        return conflict(command);
      const item = {
        ...original,
        state: 'pending' as const,
        revision: done.revision + 1,
      };
      resolved = resolved.filter((entry) => entry.itemId !== command.itemId);
      items = [...items, item];
      return materialReviewUndoResultSchema.parse({
        status: 'success',
        replayed: false,
        result: {
          previousRevision: done.revision,
          item,
          invalidatedDraftIds: [],
          auditId: `sample-audit-${++audit}`,
          resume: null,
        },
      });
    },
  };
}
