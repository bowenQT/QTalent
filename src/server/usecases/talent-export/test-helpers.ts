import {
  fixture as personFixture,
  nodeFixture,
} from '../../queries/person-test-helpers';
import type { ExportStore, ExportPhase, ExportSnapshot } from './types';
export function snapshot(
  role: 'manager' | 'hr' | 'mentor' | 'admin' = 'manager',
): ExportSnapshot {
  const base = nodeFixture();
  const grants = personFixture(role).context.grants;
  base.directory.grants = grants.map((g) => ({ ...g, id: 'grant' }));
  base.directory.account = {
    ...base.directory.account,
    isSystemAdmin: role === 'admin',
  };
  base.directory.people.forEach((p) => {
    p.name = '演示·' + p.id;
  });
  return {
    ...base,
    context: {
      ...base.context,
      account: { ...base.context.account, isSystemAdmin: role === 'admin' },
      grants,
      now: '2026-09-04T00:00:00.000Z',
      evaluationNodes: base.context.evaluationNodes!,
      evaluationNodeSubjects: base.context.evaluationNodeSubjects!,
      evaluationRelations: base.context.evaluationRelations!,
    },
    events: base.events.map((e) => ({ ...e, withdrawnAt: null })),
    nodes: base.context.evaluationNodes!.map((n) => ({
      ...n,
      name: '演示·' + n.id,
    })),
    ruleVersions: [
      {
        id: 'rubric-v1',
        provenance: 'demo_import_snapshot',
        sourceCommit: '2e51b50',
      },
    ],
    reviews: [],
    suggestions: [],
  };
}
export function openReview(
  data: ExportSnapshot,
  reason = 'ai_changed_without_reason',
) {
  data.reviews.push({
    id: 'review-0',
    eventId: 'event-0',
    dimensionId: 'prof',
    reason,
    status: 'open',
    saveId: null,
    confirmationId: null,
    counterpartConfirmationId: null,
    withdrawnAt: null,
  });
}

export function memoryFixture() {
  const f = {
    data: snapshot(),
    reads: 0,
    failAudit: false,
    change: (read: number) => {
      void read;
    },
    audits: [] as { phase: ExportPhase; outcome: string }[],
  };
  const store: ExportStore<{ audits: typeof f.audits }> = {
    async transaction(work) {
      const tx = { audits: structuredClone(f.audits) };
      const result = await work(tx);
      f.audits = tx.audits;
      return result;
    },
    async readSnapshot(_tx, _account, now) {
      f.change(++f.reads);
      // The issued intake table is frozen and cannot be cloned into a plain object.
      const { intake, ...rest } = f.data;
      const data = { ...structuredClone(rest), intake };
      data.context.now = now;
      return data;
    },
    async audit(tx, event) {
      if (f.failAudit) throw new Error('synthetic audit failure');
      tx.audits.push({ phase: event.phase, outcome: event.outcome });
    },
  };
  return { f, store };
}
