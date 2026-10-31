import { describe, it, expect, vi } from 'vitest';
import {
  createManagementObservation,
  readManagementObservations,
  type ManagementObservationPorts,
} from './management-observations';
import {
  observationFingerprint,
  referenceKey,
  type ObservationReference,
} from '../modules/records/management-observations/model';
import {
  context,
  subject,
  manual,
  imported,
  attribution,
  source,
  observation,
  reference,
  impression,
  now,
} from '../modules/records/management-observations/__tests__/fixtures';
function harness(role: Parameters<typeof context>[0] = 'hr') {
  const state = {
    context: context(role),
    rows: new Map<string, unknown>(),
    operations: new Map<
      string,
      { fingerprint: string; observationId: string }
    >(),
    audits: [] as string[],
    facts: [source()],
    attribution: attribution(),
    trace: [] as string[],
  };
  let serial = 0;
  const tx = { unitTestOnly: true };
  const ports: ManagementObservationPorts<typeof tx> = {
    transaction: vi.fn(async (work) => {
      const rows = structuredClone(state.rows),
        ops = structuredClone(state.operations),
        audits = [...state.audits];
      try {
        return await work(tx);
      } catch (error) {
        state.rows = rows;
        state.operations = ops;
        state.audits = audits;
        throw error;
      }
    }),
    lockOperation: vi.fn(async () => {
      state.trace.push('lock');
    }),
    loadSnapshot: vi.fn(async () => {
      state.trace.push('snapshot');
      return { context: structuredClone(state.context), actorName: '演示HR甲' };
    }),
    loadSources: vi.fn(async (_tx, refs: ObservationReference[]) =>
      state.facts.filter((f) =>
        refs.some((r) => referenceKey(r) === referenceKey(f)),
      ),
    ),
    loadAttribution: vi.fn(async () => structuredClone(state.attribution)),
    readOperation: vi.fn(
      async (_tx, account, key) =>
        state.operations.get(JSON.stringify([account, key])) ?? null,
    ),
    readObservation: vi.fn(async (_tx, id) =>
      structuredClone(state.rows.get(id)),
    ),
    listObservations: vi.fn(async () =>
      [...state.rows.values()].map((v) => structuredClone(v)),
    ),
    insertObservation: vi.fn(async (_tx, row) => {
      state.rows.set(row.id, structuredClone(row));
    }),
    saveOperation: vi.fn(
      async (_tx, account, key, fingerprint, observationId) => {
        state.operations.set(JSON.stringify([account, key]), {
          fingerprint,
          observationId,
        });
      },
    ),
    audit: vi.fn(async (_tx, _account, id) => {
      state.audits.push(id);
    }),
    allocateId: () => `demo-observation-${++serial}`,
  };
  return { state, ports, account: state.context.account.id };
}
describe('BOW-904 independent observation orchestration (in-memory ports, not PG)', () => {
  it('saves a handwritten opinion without SBI, events, scores or producers', async () => {
    const h = harness();
    const result = await createManagementObservation(
      h.ports,
      h.account,
      manual(),
    );
    expect(result).toMatchObject({
      replayed: false,
      observation: {
        text: impression,
        occurredAt: '2026-10-03',
        recordedAt: now,
        author: { personId: 'demo-hr', name: '演示HR甲' },
        importedBy: null,
        authorUnconfirmed: false,
        kind: 'management-observation',
        nature: 'management_observation',
      },
    });
    expect(h.state.rows.size).toBe(1);
    expect(h.state.operations.size).toBe(1);
    expect(h.state.audits).toHaveLength(1);
    expect(h.state.trace.slice(0, 2)).toEqual(['lock', 'snapshot']);
    expect(result.observation).not.toHaveProperty('eventId');
    expect(result.observation).not.toHaveProperty('score');
  });
  it('imports original interviewer signature and interview date, separately from importer and ingestion time', async () => {
    const h = harness();
    const result = await createManagementObservation(
      h.ports,
      h.account,
      imported(),
    );
    expect(result.observation).toMatchObject({
      author: { personId: 'demo-interviewer', name: '演示面试官甲' },
      authorUnconfirmed: true,
      importedBy: { personId: 'demo-hr', name: '演示HR甲' },
      occurredAt: '2026-10-01',
      recordedAt: now,
      sources: [{ ...reference, location: source().location }],
    });
    expect(result.observation.occurredAt).not.toBe(
      result.observation.recordedAt,
    );
  });
  it('preserves an unmapped external interviewer without guessing an identity or confirming them', async () => {
    const h = harness();
    h.state.attribution.interviewer.personId = null;
    const result = await createManagementObservation(
      h.ports,
      h.account,
      imported(),
    );
    expect(result.observation.author).toEqual({
      personId: null,
      name: '演示面试官甲',
    });
    expect(result.observation.authorUnconfirmed).toBe(true);
  });
  it.each(['employee', 'admin', 'manager'] as const)(
    'rejects %s importing before any attribution/source lookup',
    async (role) => {
      const h = harness(role);
      await expect(
        createManagementObservation(h.ports, h.account, imported()),
      ).rejects.toMatchObject({ code: 'forbidden' });
      expect(h.ports.loadAttribution).not.toHaveBeenCalled();
      expect(h.ports.loadSources).not.toHaveBeenCalled();
    },
  );
  it('does not permit request-supplied authors, confirmation flags or scores', async () => {
    const h = harness();
    for (const change of [
      { author: { personId: 'forged' } },
      { authorUnconfirmed: false },
      { value: 5 },
    ])
      await expect(
        createManagementObservation(h.ports, h.account, {
          ...imported(),
          ...change,
        }),
      ).rejects.toMatchObject({ code: 'invalid_input' });
    expect(h.ports.transaction).not.toHaveBeenCalled();
  });
  it.each(['text', 'person', 'node', 'refs', 'identity', 'missing'] as const)(
    'rejects inconsistent trusted import metadata: %s',
    async (field) => {
      const h = harness();
      if (field === 'text') h.state.attribution.text = '演示HR改写';
      if (field === 'person') h.state.attribution.personId = 'demo-hr';
      if (field === 'node')
        h.state.attribution.evaluationNodeId = 'demo-other-node';
      if (field === 'refs')
        h.state.attribution.sources = [
          { ...reference, originalVersionId: 'wrong' },
        ];
      if (field === 'identity')
        h.state.attribution.interviewer.personId = 'unknown';
      if (field === 'missing')
        vi.mocked(h.ports.loadAttribution).mockResolvedValue(null);
      await expect(
        createManagementObservation(h.ports, h.account, imported()),
      ).rejects.toMatchObject({ code: 'invalid_source' });
      expect(h.state.rows.size).toBe(0);
    },
  );
  it('rejects source kind/scope and malformed references before inserting', async () => {
    const h = harness('author');
    h.state.facts[0].requiredKinds = ['management-observation'];
    await expect(
      createManagementObservation(h.ports, h.account, {
        ...manual(),
        sources: [reference],
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(h.ports.insertObservation).not.toHaveBeenCalled();
    vi.mocked(h.ports.loadSources).mockResolvedValue([{}]);
    await expect(
      createManagementObservation(h.ports, h.account, {
        ...manual(),
        sources: [reference],
      }),
    ).rejects.toMatchObject({ code: 'invalid_source' });
  });
  it('replays the same operation without duplicating records/audit and conflicts on changed content', async () => {
    const h = harness();
    const first = await createManagementObservation(
      h.ports,
      h.account,
      manual(),
    );
    const replay = await createManagementObservation(
      h.ports,
      h.account,
      manual(),
    );
    expect(replay).toEqual({ ...first, replayed: true });
    expect(h.state.rows.size).toBe(1);
    expect(h.state.audits).toHaveLength(1);
    await expect(
      createManagementObservation(h.ports, h.account, {
        ...manual(),
        text: '演示另一看法',
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
  it('rechecks current permissions on old successful requests', async () => {
    const h = harness();
    await createManagementObservation(h.ports, h.account, manual());
    h.state.context.grants = [];
    await expect(
      createManagementObservation(h.ports, h.account, manual()),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('loads authorization after the operation lock and rejects a revocation while waiting', async () => {
    const h = harness();
    vi.mocked(h.ports.lockOperation).mockImplementation(async () => {
      h.state.context.grants = [];
      h.state.trace.push('lock');
    });
    await expect(
      createManagementObservation(h.ports, h.account, manual()),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(h.state.trace).toEqual(['lock', 'snapshot']);
  });
  it.each(['audit', 'ledger', 'revoked', 'source'] as const)(
    'rolls back the port transaction after %s failure (not a PG claim)',
    async (cause) => {
      const h = harness();
      if (cause === 'audit')
        vi.mocked(h.ports.audit).mockRejectedValue(
          new Error('demo audit failed'),
        );
      if (cause === 'ledger')
        vi.mocked(h.ports.saveOperation).mockRejectedValue(
          new Error('demo ledger failed'),
        );
      if (cause === 'revoked')
        vi.mocked(h.ports.audit).mockImplementation(async () => {
          h.state.context.grants = [];
        });
      if (cause === 'source')
        vi.mocked(h.ports.audit).mockImplementation(async () => {
          h.state.facts[0].subjects[0].evaluationNodeId = 'missing';
        });
      await expect(
        createManagementObservation(h.ports, h.account, imported()),
      ).rejects.toBeInstanceOf(Error);
      expect(h.state.rows.size).toBe(0);
      expect(h.state.operations.size).toBe(0);
      expect(h.state.audits).toHaveLength(0);
    },
  );
  it('fails closed on a mismatched session binding or unknown actor', async () => {
    const h = harness();
    await expect(
      createManagementObservation(h.ports, 'other-account', manual()),
    ).rejects.toMatchObject({ code: 'forbidden' });
    h.state.context.people = h.state.context.people.filter(
      (p) => p.id !== 'demo-hr',
    );
    await expect(
      createManagementObservation(h.ports, h.account, manual()),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('rejects a corrupt replay record rather than returning an unrelated result', async () => {
    const h = harness();
    h.state.operations.set(JSON.stringify([h.account, 'demo-operation']), {
      fingerprint: observationFingerprint(manual()),
      observationId: 'missing',
    });
    await expect(
      createManagementObservation(h.ports, h.account, manual()),
    ).rejects.toMatchObject({ code: 'invalid_data' });
  });
  it('reads HR-authorized views and filters rows outside the requested node', async () => {
    const h = harness();
    await createManagementObservation(h.ports, h.account, imported());
    h.state.rows.set('other', {
      ...observation(),
      id: 'other',
      evaluationNodeId: 'demo-other-node',
    });
    expect(
      await readManagementObservations(h.ports, h.account, subject),
    ).toHaveLength(1);
  });
  it('authors cannot see another author or cause its source metadata to load', async () => {
    const h = harness('author');
    const mine = observation();
    h.state.rows.set(mine.id, mine);
    h.state.rows.set('other', {
      ...mine,
      id: 'other',
      author: { personId: 'demo-other-author', name: '演示乙' },
      sources: [reference],
    });
    const result = await readManagementObservations(
      h.ports,
      h.account,
      subject,
    );
    expect(result.map((row) => row.id)).toEqual([mine.id]);
    expect(h.ports.loadSources).toHaveBeenCalledTimes(1);
    expect(
      vi
        .mocked(h.ports.loadSources)
        .mock.calls.every(([, refs]) => refs.length === 0),
    ).toBe(true);
  });
  it('rejects employee reads without fetching any records or source metadata', async () => {
    const h = harness('employee');
    await expect(
      readManagementObservations(h.ports, h.account, subject),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(h.ports.listObservations).not.toHaveBeenCalled();
    expect(h.ports.loadSources).not.toHaveBeenCalled();
  });
  it('does not return a stale row after access is revoked during an asynchronous read', async () => {
    const h = harness();
    h.state.rows.set('demo-observation', observation());
    vi.mocked(h.ports.loadSources).mockImplementation(async () => {
      h.state.context.grants = [];
      return [];
    });
    await expect(
      readManagementObservations(h.ports, h.account, subject),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('rejects malformed read inputs/data, and drops current unreadable citations', async () => {
    const h = harness();
    await expect(
      readManagementObservations(h.ports, h.account, {}),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    h.state.rows.set('bad', {});
    await expect(
      readManagementObservations(h.ports, h.account, subject),
    ).rejects.toMatchObject({ code: 'invalid_data' });
    h.state.rows.clear();
    h.state.rows.set('demo-observation', {
      ...observation(),
      sources: [reference],
    });
    h.state.facts = [];
    expect(
      await readManagementObservations(h.ports, h.account, subject),
    ).toEqual([]);
  });
});

it('rejects revocation while the final source lookup waits on create or read', async () => {
  for (const mode of ['create', 'read']) {
    const h = harness();
    let calls = 0;
    h.state.rows.set('demo-observation', {
      ...observation(),
      sources: [reference],
    });
    vi.mocked(h.ports.loadSources).mockImplementation(async () => {
      if (++calls === (mode === 'create' ? 2 : 1)) h.state.context.grants = [];
      return h.state.facts;
    });
    const result =
      mode === 'create'
        ? createManagementObservation(h.ports, h.account, imported())
        : readManagementObservations(h.ports, h.account, subject);
    await expect(result).rejects.toMatchObject({ code: 'forbidden' });
  }
});

it('does not load sources when a corrupt replay points to another author', async () => {
  const h = harness('author');
  const first = await createManagementObservation(h.ports, h.account, manual());
  const stored = h.state.rows.get(first.observation.id);
  if (typeof stored !== 'object' || stored === null)
    throw new Error('Missing fixture record');
  h.state.rows.set(first.observation.id, {
    ...stored,
    author: { personId: 'demo-other-author', name: '演示乙' },
  });
  vi.mocked(h.ports.loadSources).mockClear();
  await expect(
    createManagementObservation(h.ports, h.account, manual()),
  ).rejects.toMatchObject({ code: 'forbidden' });
  expect(h.ports.loadSources).not.toHaveBeenCalled();
});

it('rejects a stored replay whose immutable content no longer matches its receipt', async () => {
  const h = harness();
  const created = await createManagementObservation(
    h.ports,
    h.account,
    manual(),
  );
  const stored = h.state.rows.get(created.observation.id);
  if (typeof stored !== 'object' || stored === null)
    throw new Error('Missing fixture record');
  h.state.rows.set(created.observation.id, {
    ...stored,
    text: '演示：被意外改写',
  });
  await expect(
    createManagementObservation(h.ports, h.account, manual()),
  ).rejects.toMatchObject({ code: 'invalid_data' });
});
