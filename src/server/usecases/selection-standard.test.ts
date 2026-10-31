import {
  createSelectionPostgresStore,
  SelectionPersistenceUnavailableError,
  type SelectionPostgresTransaction,
  type SelectionPostgresServices,
} from '../modules/evaluation-system/selection/postgres';
import type { Database, Transaction } from '../db/client';
import { expect, it, vi } from 'vitest';
import {
  executeSelectionRevision,
  readSelectionCohortVersion,
  type SelectionStandardPorts,
  type SelectionOperation,
} from './selection-standard';
import {
  type SelectionRevisionRecord,
  type SelectionAuthority,
} from '../modules/evaluation-system/selection-standard';
import {
  selectionRevisionSchema,
  type SelectionCohortBinding,
  type EffectiveRuleVersion,
  type SelectionPublicationReceipt,
} from '../../contracts/selection-standard';
import {
  selectionRevisionFixture,
  selectionImpactPreviewFixture,
  comparisonManagerFixture,
  iterationDemoHr,
  iterationDemoManager,
  iterationDemoCohort,
  iterationDemoNextCohort,
} from '../../contracts/standard-iteration.fixtures';

const now = '2026-10-31T10:00:00.000Z';
const hrAccount = 'demo-hr-account';
const managerAccount = 'demo-manager-account';
function auth(accountId: string): SelectionAuthority {
  const hr = accountId === hrAccount;
  return {
    actor: hr ? iterationDemoHr : iterationDemoManager,
    context: {
      account: {
        id: accountId,
        personId: hr ? iterationDemoHr.id : iterationDemoManager.id,
        isSystemAdmin: false,
      },
      now,
      grants: (hr
        ? [iterationDemoCohort.id, iterationDemoNextCohort.id]
        : [null]
      ).map((cohortId) => ({
        accountId,
        role: hr ? 'hr' : 'manager',
        scope: hr ? 'cohort' : 'company',
        cohortId,
        validFrom: '2026-01-01T00:00:00Z',
        validTo: null,
        revokedAt: null,
      })),
      enrollments: [],
      assignments: [],
      projects: [],
      members: [],
      people: [],
    },
  };
}
const base: EffectiveRuleVersion = {
  category: 'xe_selection',
  versionId: 'xe-select-v1',
  provenance: 'published',
  effectiveFrom: '2026-07-01T00:00:00Z',
  effectiveUntil: null,
};
type State = {
  records: Map<string, SelectionRevisionRecord>;
  operations: Map<string, SelectionOperation>;
  publications: Map<
    string,
    {
      record: SelectionRevisionRecord;
      receipt: SelectionPublicationReceipt;
      previous: EffectiveRuleVersion;
    }
  >;
  current: EffectiveRuleVersion;
  publicationId: string | null;
  bindings: SelectionCohortBinding[];
  audits: string[];
  authorities: Map<string, SelectionAuthority>;
  nextId: number;
};
/** An in-memory UNIT port harness. It cannot establish PostgreSQL concurrency,
 * durable commits, real rollback or restart acceptance; those remain blocked.
 */
function harness() {
  let state: State = {
    records: new Map(),
    operations: new Map(),
    publications: new Map(),
    current: base,
    publicationId: null,
    bindings: selectionImpactPreviewFixture().preservedBindings,
    audits: [],
    authorities: new Map([
      [hrAccount, auth(hrAccount)],
      [managerAccount, auth(managerAccount)],
    ]),
    nextId: 0,
  };
  const ports: SelectionStandardPorts<State> = {
    async transact(_lock, work) {
      const copy = structuredClone(state);
      const result = await work(copy);
      state = copy;
      return result;
    },
    async read(work) {
      return work(structuredClone(state));
    },
    loadAuthority: vi.fn(async (tx, accountId, at) => {
      const authority = structuredClone(tx.authorities.get(accountId)!);
      authority.context.now = at;
      return authority;
    }),
    readOperation: vi.fn(
      async (tx, accountId, id) =>
        tx.operations.get(accountId + ':' + id) ?? null,
    ),
    writeOperation: vi.fn(async (tx, accountId, id, operation) => {
      tx.operations.set(accountId + ':' + id, operation);
    }),
    creationFacts: vi.fn(async () => ({
      scopeCohortId: iterationDemoCohort.id,
      basis: selectionRevisionFixture().basis,
      managerBasis: comparisonManagerFixture().batches,
      baseContent: {
        reviewPoints: [
          {
            id: 'demo-basic',
            title: '作品来源',
            description: '演示：保留原始出处',
          },
        ],
      },
      impact: {
        nextCohort: iterationDemoNextCohort,
        existingResults: selectionImpactPreviewFixture().existingResults,
        preservedBindings: selectionImpactPreviewFixture().preservedBindings,
      },
    })),
    readRevision: vi.fn(async (tx, id) => tx.records.get(id) ?? null),
    readImpact: vi.fn(async () => ({
      nextCohort: iterationDemoNextCohort,
      existingResults: selectionImpactPreviewFixture().existingResults,
      preservedBindings: selectionImpactPreviewFixture().preservedBindings,
    })),
    readEffectiveRuleVersion: vi.fn(async (tx) => ({
      status: 'success' as const,
      version: tx.current,
    })),
    readCurrentPublicationId: vi.fn(async (tx) => tx.publicationId),
    readPublication: vi.fn(async (tx, id) => {
      const saved = tx.publications.get(id);
      return saved
        ? { ...saved, record: tx.records.get(saved.record.revision.id)! }
        : null;
    }),
    readBindingsForUndo: vi.fn(async (tx) => tx.bindings),
    readCohortBinding: vi.fn(
      async (tx: State, id: string) =>
        tx.bindings.find((row) => row.cohort.id === id) ?? null,
    ),
    allocateId: vi.fn(async (tx, kind) => 'demo-' + kind + '-' + ++tx.nextId),
    allocateVersionId: vi.fn(async () => 'xe-select-v2'),
    persist: vi.fn(async (tx, plan) => {
      if (plan.kind === 'revision')
        tx.records.set(plan.record.revision.id, plan.record);
      else if (plan.kind === 'publish') {
        const { record, receipt, categorySwitch } = plan.publication;
        tx.publications.set(receipt.publicationId, {
          record,
          receipt,
          previous: tx.current,
        });
        tx.current = categorySwitch.activate;
        tx.publicationId = receipt.publicationId;
        tx.records.set(record.revision.id, record);
      } else {
        const { record, categorySwitch } = plan.undo;
        tx.current = categorySwitch.activate;
        tx.publicationId = null;
        tx.records.set(record.revision.id, record);
      }
    }),
    audit: vi.fn(async (tx, event) => {
      tx.audits.push(event.action);
    }),
  };
  const clock = vi.fn(() => new Date(now));
  const execute = (accountId: string, action: string, input: unknown) =>
    executeSelectionRevision(ports, accountId, { action, input }, clock);
  return { ports, clock, execute, state: () => state };
}
const create = {
  operationId: 'create',
  baseVersionId: 'xe-select-v1',
  attributionId: 'demo-attribution',
  expectedAttributionRevision: 1,
  reason: '演示：补充贡献说明',
};
async function pending(h: ReturnType<typeof harness>) {
  const created = await h.execute(hrAccount, 'create', create);
  if (created.status !== 'success')
    throw new Error('Unit fixture creation failed');
  let revision = selectionRevisionSchema.parse(created.result);
  const saved = await h.execute(hrAccount, 'save', {
    operationId: 'save',
    draftId: revision.id,
    expectedRevision: revision.revision,
    reason: create.reason,
    changes: selectionRevisionFixture().humanVersion.changes,
  });
  if (saved.status !== 'success') throw new Error('Unit fixture save failed');
  revision = selectionRevisionSchema.parse(saved.result);
  const submitted = await h.execute(hrAccount, 'submit', {
    operationId: 'submit',
    draftId: revision.id,
    expectedRevision: revision.revision,
    expectedPreviewId: revision.impactPreview.id,
  });
  if (submitted.status !== 'success')
    throw new Error('Unit fixture submission failed');
  return selectionRevisionSchema.parse(submitted.result);
}
async function publication(h: ReturnType<typeof harness>) {
  const revision = await pending(h);
  const input = {
    operationId: 'publish',
    draftId: revision.id,
    expectedRevision: revision.revision,
    expectedPreviewId: revision.impactPreview.id,
  };
  const result = await h.execute(managerAccount, 'publish', input);
  if (result.status !== 'success')
    throw new Error('Unit fixture publication failed');
  return {
    revision,
    input,
    receipt: result.result as SelectionPublicationReceipt,
  };
}
it('orchestrates actual domain plans, calls the 922 category port, and saves signed audit/operations in the unit transaction', async () => {
  const h = harness();
  const result = await publication(h);
  expect(h.state().current.versionId).toBe('xe-select-v2');
  expect(h.state().records.get(result.revision.id)!.revision.state).toBe(
    'active',
  );
  expect(h.state().audits).toEqual([
    'selection_standard.create',
    'selection_standard.save',
    'selection_standard.submit',
    'selection_standard.publish',
  ]);
  expect(h.ports.readEffectiveRuleVersion).toHaveBeenCalledWith(
    expect.anything(),
    { category: 'xe_selection', at: now },
    expect.any(Function),
  );
  expect(h.state().operations.size).toBe(4);
  expect(h.ports.audit).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({
      actorAccountId: managerAccount,
      actorPersonId: iterationDemoManager.id,
    }),
  );
  // No rubric, dimension, score, profile, frozen snapshot or historical-result
  // mutation exists in these ports; their actual DB immutability is still untested.
  expect(h.state().bindings[0].standardVersionId).toBe('xe-select-v1');
});
it('replays an identical request once, preserves input for semantic conflicts, and rechecks current scope before replay', async () => {
  const h = harness();
  const first = await h.execute(hrAccount, 'create', create);
  const repeated = await h.execute(hrAccount, 'create', { ...create });
  expect(repeated).toEqual({ ...first, replayed: true });
  expect(h.state().records.size).toBe(1);
  expect(h.state().audits).toHaveLength(1);
  h.state().authorities.get(hrAccount)!.context.grants[1].revokedAt = now;
  expect((await h.execute(hrAccount, 'create', create)).status).toBe(
    'forbidden',
  );
  h.state().authorities.get(hrAccount)!.context.grants[1].revokedAt = null;
  const changed = { ...create, reason: '不同语义' };
  expect(await h.execute(hrAccount, 'create', changed)).toMatchObject({
    status: 'conflict',
    input: changed,
  });
  h.state().authorities.get(hrAccount)!.context.grants[0].revokedAt = now;
  const denied = await h.execute(hrAccount, 'create', create);
  expect(denied.status).toBe('forbidden');
  expect(denied).not.toHaveProperty('result');
  expect(h.state().audits).toHaveLength(1);
});
it('uses the saved preview for return/withdraw flows and keeps private attribution out of manager responses', async () => {
  const h = harness();
  const revision = await pending(h);
  const returned = await h.execute(managerAccount, 'return', {
    operationId: 'return',
    draftId: revision.id,
    expectedRevision: revision.revision,
    reason: '演示：补充说明',
  });
  expect(returned.status).toBe('success');
  if (returned.status !== 'success') throw new Error('Expected return');
  expect(returned.result).toMatchObject({
    state: 'draft',
    humanVersion: { origin: 'hr_edited' },
  });
  expect(returned.result).not.toHaveProperty('aiDraft');
  expect(JSON.stringify(returned)).not.toContain('demo-comparison-');
  const stored = h.state().records.get(revision.id)!.revision;
  const resubmitted = await h.execute(hrAccount, 'submit', {
    operationId: 'resubmit',
    draftId: stored.id,
    expectedRevision: stored.revision,
    expectedPreviewId: stored.impactPreview.id,
  });
  if (resubmitted.status !== 'success') throw new Error('Expected resubmit');
  const r = selectionRevisionSchema.parse(resubmitted.result);
  const withdrawn = await h.execute(hrAccount, 'withdraw', {
    operationId: 'withdraw',
    draftId: r.id,
    expectedRevision: r.revision,
  });
  expect(withdrawn).toMatchObject({
    status: 'success',
    result: { state: 'draft', impactPreview: revision.impactPreview },
  });
});
it('executes the paired undo plan and reads bound sixth/seventh versions without consulting global-current fallback', async () => {
  const h = harness();
  const pub = await publication(h);
  const seventh = {
    cohort: iterationDemoNextCohort,
    standardVersionId: 'xe-select-v2',
    boundAt: now,
  };
  h.state().bindings.push(seventh);
  h.clock.mockReturnValue(new Date('2026-10-31T10:00:04.999Z'));
  const undone = await h.execute(managerAccount, 'undo', {
    operationId: 'undo',
    publicationId: pub.receipt.publicationId,
    expectedRevision: pub.receipt.revision,
  });
  expect(undone).toMatchObject({
    status: 'success',
    result: {
      restoredDefaultForNewCohorts: 'xe-select-v1',
      preservedBindings: [expect.anything(), seventh],
    },
  });
  expect(h.state().current.versionId).toBe('xe-select-v1');
  expect(h.state().records.get(pub.revision.id)!.revision.state).toBe(
    'pending_confirmation',
  );
  vi.mocked(h.ports.readEffectiveRuleVersion).mockClear();
  expect(
    await readSelectionCohortVersion(
      h.ports,
      hrAccount,
      { cohortId: iterationDemoCohort.id },
      h.clock,
    ),
  ).toMatchObject({
    status: 'success',
    binding: { standardVersionId: 'xe-select-v1' },
  });
  expect(
    await readSelectionCohortVersion(
      h.ports,
      managerAccount,
      { cohortId: iterationDemoNextCohort.id },
      h.clock,
    ),
  ).toMatchObject({ status: 'success', binding: seventh });
  expect(h.ports.readEffectiveRuleVersion).not.toHaveBeenCalled();
});
it('does not commit the unit-of-work model if a persistence/audit/operation port fails', async () => {
  for (const failure of ['persist', 'audit', 'writeOperation'] as const) {
    const h = harness();
    const revision = await pending(h);
    const snapshot = structuredClone(h.state());
    vi.mocked(h.ports[failure]).mockRejectedValueOnce(
      new Error('synthetic ' + failure),
    );
    await expect(
      h.execute(managerAccount, 'publish', {
        operationId: 'publish',
        draftId: revision.id,
        expectedRevision: revision.revision,
        expectedPreviewId: revision.impactPreview.id,
      }),
    ).rejects.toThrow('synthetic');
    expect(h.state()).toEqual(snapshot);
  }
});
it('keeps the 922 not-found/conflict result explicit and never chooses an arbitrary version', async () => {
  for (const status of ['not_found', 'conflict', 'forbidden'] as const) {
    const h = harness();
    vi.mocked(h.ports.readEffectiveRuleVersion).mockResolvedValueOnce({
      status,
      message: '演示：类别读取不可用',
    });
    expect(await h.execute(hrAccount, 'create', create)).toMatchObject({
      status,
      message: '演示：类别读取不可用',
    });
    expect(h.ports.persist).not.toHaveBeenCalled();
    expect(h.ports.writeOperation).not.toHaveBeenCalled();
  }
});
it('returns not-found without content and rejects invalid transport extensions before opening a transaction', async () => {
  const h = harness();
  const submit = {
    operationId: 'submit',
    draftId: 'missing',
    expectedRevision: 1,
    expectedPreviewId: 'missing',
  };
  expect(await h.execute(hrAccount, 'submit', submit)).toEqual({
    status: 'not_found',
    message: '草稿不存在或不可见',
  });
  expect(
    await h.execute(managerAccount, 'undo', {
      operationId: 'undo',
      publicationId: 'missing',
      expectedRevision: 1,
    }),
  ).toMatchObject({ status: 'not_found' });
  const transaction = vi.fn();
  const original = h.ports.transact;
  h.ports.transact = async (lock, work) => {
    transaction(lock);
    return original(lock, work);
  };
  for (const raw of [
    null,
    { action: 'publish', input: { ...submit, actor: iterationDemoManager } },
    { action: 'submit', input: submit, role: 'manager' },
  ]) {
    expect(
      (await executeSelectionRevision(h.ports, hrAccount, raw, h.clock)).status,
    ).toBe('validation_error');
  }
  expect(transaction).not.toHaveBeenCalled();
});
it('returns a typed conflict retaining edits when a valid command would remove the last review point', async () => {
  const h = harness();
  const created = await h.execute(hrAccount, 'create', create);
  if (created.status !== 'success') throw new Error('Expected draft');
  const revision = selectionRevisionSchema.parse(created.result);
  const before = h.state().records.get(revision.id)!.baseContent
    .reviewPoints[0];
  const input = {
    operationId: 'remove-last',
    draftId: revision.id,
    expectedRevision: revision.revision,
    reason: create.reason,
    changes: [{ kind: 'remove', before }],
  };
  expect(await h.execute(hrAccount, 'save', input)).toMatchObject({
    status: 'conflict',
    input,
  });
  expect(h.state().records.get(revision.id)!.revision.revision).toBe(1);
  expect(h.state().audits).toHaveLength(1);
});
it('resolves time and current authority only after the category lock port invokes work', async () => {
  const h = harness();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = h.ports.transact;
  h.ports.transact = async (lock, work) => {
    await held;
    return original(lock, work);
  };
  const result = h.execute(hrAccount, 'create', create);
  expect(h.clock).not.toHaveBeenCalled();
  h.state()
    .authorities.get(hrAccount)!
    .context.grants.forEach((grant) => {
      grant.revokedAt = now;
    });
  release();
  expect((await result).status).toBe('forbidden');
  expect(h.state().records.size).toBe(0);
});
it('does not trust a loader returning a different session account and authorizes cohort reads before lookup', async () => {
  const h = harness();
  vi.mocked(h.ports.loadAuthority).mockResolvedValueOnce(auth(managerAccount));
  expect((await h.execute(hrAccount, 'create', create)).status).toBe(
    'forbidden',
  );
  expect(h.ports.creationFacts).not.toHaveBeenCalled();
  expect(
    await readSelectionCohortVersion(
      h.ports,
      hrAccount,
      { cohortId: 'hidden-cohort' },
      h.clock,
    ),
  ).toEqual({ status: 'forbidden', message: '你没有读取此期次选拔标准的权限' });
  expect(h.ports.readCohortBinding).not.toHaveBeenCalled();
  expect(
    (
      await readSelectionCohortVersion(
        h.ports,
        managerAccount,
        { cohortId: 'missing' },
        h.clock,
      )
    ).status,
  ).toBe('not_found');
  vi.mocked(h.ports.readCohortBinding).mockResolvedValueOnce({
    ...h.state().bindings[0],
    cohort: iterationDemoNextCohort,
  });
  await expect(
    readSelectionCohortVersion(
      h.ports,
      hrAccount,
      { cohortId: iterationDemoCohort.id },
      h.clock,
    ),
  ).rejects.toThrow('identity mismatch');
});

it('rejects a cached authority timestamp even when the account matches', async () => {
  const h = harness();
  h.clock.mockReturnValue(new Date('2026-11-01T00:00:00.000Z'));
  vi.mocked(h.ports.loadAuthority).mockResolvedValueOnce(auth(hrAccount));
  expect((await h.execute(hrAccount, 'create', create)).status).toBe(
    'forbidden',
  );
  expect(h.ports.creationFacts).not.toHaveBeenCalled();
});

// Native adapter context/error boundary only. This I/O harness does not execute
// SQL or establish real PostgreSQL lock, rollback, durability or restart evidence.
function nativeReadBoundary() {
  const select = vi.fn(() => {
    throw new Error('SQL must not run in this boundary test');
  });
  const native = { select } as unknown as Transaction;
  const database = {
    transaction: async <R>(work: (tx: Transaction) => Promise<R>) =>
      work(native),
  } as unknown as Database;
  const services: SelectionPostgresServices = {
    loadAuthority: vi.fn(async (_tx, id, at) => {
      const value = structuredClone(auth(id));
      value.context.now = at;
      return value;
    }),
    creationFacts: vi.fn(async () => {
      throw new Error('not installed in this unit harness');
    }),
    readImpact: vi.fn(async () => {
      throw new Error('not installed in this unit harness');
    }),
    readCohort: vi.fn(async () => {
      throw new Error('not installed in this unit harness');
    }),
  };
  const store = createSelectionPostgresStore(database, services);
  return { store, services, select, native, database };
}
it('native adapter has no production defaults for missing current-identity/fact readers', () => {
  const f = nativeReadBoundary();
  expect(() =>
    createSelectionPostgresStore(f.database, {} as SelectionPostgresServices),
  ).toThrow(SelectionPersistenceUnavailableError);
  expect(f.select).not.toHaveBeenCalled();
});
it('native adapter refuses forged, copied and other-store contexts before SQL', async () => {
  const f = nativeReadBoundary();
  const other = nativeReadBoundary();
  await f.store.ports.read(async (tx) => {
    for (const forged of [{ db: f.native }, { ...tx }])
      await expect(
        f.store.ports.readRevision(
          forged as SelectionPostgresTransaction,
          'demo',
        ),
      ).rejects.toBeInstanceOf(SelectionPersistenceUnavailableError);
    await expect(
      other.store.ports.readRevision(tx, 'demo'),
    ).rejects.toBeInstanceOf(SelectionPersistenceUnavailableError);
  });
  expect(f.select).not.toHaveBeenCalled();
  expect(other.select).not.toHaveBeenCalled();
});
it('native adapter expires contexts at callback end and refuses readonly writes', async () => {
  const f = nativeReadBoundary();
  let captured: SelectionPostgresTransaction | undefined;
  await f.store.ports.read(async (tx) => {
    captured = tx;
    await expect(f.store.ports.readRevision(tx, 'demo')).rejects.toBeInstanceOf(
      SelectionPersistenceUnavailableError,
    );
    await expect(f.store.ports.allocateId(tx, 'draft')).rejects.toBeInstanceOf(
      SelectionPersistenceUnavailableError,
    );
  });
  await expect(
    f.store.ports.readRevision(captured!, 'demo'),
  ).rejects.toBeInstanceOf(SelectionPersistenceUnavailableError);
  expect(f.select).not.toHaveBeenCalled();
});
it('native adapter verifies current account, person, admin exclusion and business time', async () => {
  for (const invalid of ['account', 'person', 'admin', 'time'] as const) {
    const f = nativeReadBoundary();
    vi.mocked(f.services.loadAuthority).mockImplementation(async () => {
      const value = structuredClone(auth(hrAccount));
      if (invalid === 'account') value.context.account.id = 'other';
      if (invalid === 'person') value.actor.id = 'other';
      if (invalid === 'admin') value.context.account.isSystemAdmin = true;
      if (invalid === 'time') value.context.now = '2026-10-31T09:00:00.000Z';
      return value;
    });
    await expect(
      f.store.ports.read((tx) =>
        f.store.ports.loadAuthority(tx, hrAccount, now),
      ),
    ).rejects.toMatchObject({ status: 'forbidden' });
    expect(f.select).not.toHaveBeenCalled();
  }
});
it('native current authority is immutable and rejects a different account in the same transaction', async () => {
  const f = nativeReadBoundary();
  await f.store.ports.read(async (tx) => {
    const current = await f.store.ports.loadAuthority(tx, hrAccount, now);
    expect(Object.isFrozen(current.context.grants)).toBe(true);
    expect(() => {
      current.context.account.personId = 'other';
    }).toThrow();
    await expect(
      f.store.ports.loadAuthority(tx, managerAccount, now),
    ).rejects.toMatchObject({ status: 'forbidden' });
  });
});
it('native storage errors retain only stable SQLSTATE, never query values or private causes', async () => {
  const f = nativeReadBoundary();
  vi.mocked(f.services.loadAuthority).mockRejectedValue(
    Object.assign(new Error('private query and raw parameters'), {
      cause: { code: '42P01', detail: 'private' },
    }),
  );
  const error = await f.store.ports
    .read((tx) => f.store.ports.loadAuthority(tx, hrAccount, now))
    .catch((value: unknown) => value);
  expect(error).toBeInstanceOf(SelectionPersistenceUnavailableError);
  expect(error).toMatchObject({ databaseCode: '42P01' });
  expect(String(error) + JSON.stringify(error)).not.toContain('private');
});
