import type { EvaluationAuthzContext } from '../authz/evaluation-node';
import {
  canCreateObservation,
  canReadObservation,
} from '../modules/records/management-observations/policy';
import { projectManagementObservation } from '../modules/records/management-observations/read';
import {
  createObservationInputSchema,
  interviewAttributionSchema,
  managementObservationSchema,
  observationSubjectSchema,
  observationSourceSchema,
  observationFingerprint,
  referenceKey,
  ObservationError,
  type CreateObservationInput,
  type ObservationReference,
  type ObservationSubject,
  type ManagementObservation,
  type VisibleObservation,
  type ObservationSource,
} from '../modules/records/management-observations/model';

export interface ObservationSnapshot {
  context: EvaluationAuthzContext;
  actorName: string;
}
/** Adapter must use one transaction, lock BEFORE loading current facts, and rollback audit/ledger failures. */
export interface ManagementObservationPorts<Tx> {
  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T>;
  lockOperation(tx: Tx, accountId: string, operationId: string): Promise<void>;
  loadSnapshot(tx: Tx, accountId: string): Promise<ObservationSnapshot>;
  loadSources(tx: Tx, references: ObservationReference[]): Promise<unknown[]>;
  loadAttribution(tx: Tx, id: string): Promise<unknown>;
  readOperation(
    tx: Tx,
    accountId: string,
    operationId: string,
  ): Promise<{ fingerprint: string; observationId: string } | null>;
  readObservation(tx: Tx, id: string): Promise<unknown>;
  listObservations(tx: Tx, subject: ObservationSubject): Promise<unknown[]>;
  insertObservation(tx: Tx, row: ManagementObservation): Promise<void>;
  saveOperation(
    tx: Tx,
    accountId: string,
    operationId: string,
    fingerprint: string,
    observationId: string,
  ): Promise<void>;
  audit(tx: Tx, accountId: string, observationId: string): Promise<void>;
  allocateId(): string;
}
async function snapshot<Tx>(
  ports: ManagementObservationPorts<Tx>,
  tx: Tx,
  accountId: string,
): Promise<ObservationSnapshot> {
  const result = await ports.loadSnapshot(tx, accountId);
  if (
    result.context.account.id !== accountId ||
    !result.actorName.trim() ||
    !result.context.people.some(
      (person) =>
        person.id === result.context.account.personId && !person.noReview,
    )
  )
    throw new ObservationError('forbidden');
  return result;
}
async function sourceFacts<Tx>(
  ports: ManagementObservationPorts<Tx>,
  tx: Tx,
  row: ManagementObservation,
): Promise<ObservationSource[]> {
  const parsed = observationSourceSchema
    .array()
    .safeParse(await ports.loadSources(tx, row.sources));
  if (!parsed.success) throw new ObservationError('invalid_source');
  return parsed.data;
}
export async function createManagementObservation<Tx>(
  ports: ManagementObservationPorts<Tx>,
  accountId: string,
  raw: unknown,
) {
  const parsed = createObservationInputSchema.safeParse(raw);
  if (!parsed.success) throw new ObservationError('invalid_input');
  const input = parsed.data;
  const fingerprint = observationFingerprint(input);
  return ports.transaction(async (tx) => {
    await ports.lockOperation(tx, accountId, input.operationId);
    const current = await snapshot(ports, tx, accountId);
    if (!canCreateObservation(current.context, input, input.origin))
      throw new ObservationError('forbidden');
    const previous = await ports.readOperation(
      tx,
      accountId,
      input.operationId,
    );
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new ObservationError('conflict');
      const found = managementObservationSchema.safeParse(
        await ports.readObservation(tx, previous.observationId),
      );
      if (
        !found.success ||
        found.data.id !== previous.observationId ||
        found.data.recordedByAccountId !== accountId ||
        found.data.personId !== input.personId ||
        found.data.evaluationNodeId !== input.evaluationNodeId ||
        found.data.text !== input.text ||
        found.data.origin !== input.origin ||
        (input.origin === 'manual' &&
          found.data.occurredAt !== input.occurredAt) ||
        (input.origin === 'interview_import' &&
          found.data.attributionId !== input.attributionId) ||
        JSON.stringify(found.data.sources.map(referenceKey).sort()) !==
          JSON.stringify(input.sources.map(referenceKey).sort())
      )
        throw new ObservationError('invalid_data');
      if (!canReadObservation(current.context, found.data))
        throw new ObservationError('forbidden');
      const facts = await sourceFacts(ports, tx, found.data);
      const latest = await snapshot(ports, tx, accountId);
      if (!canCreateObservation(latest.context, input, input.origin))
        throw new ObservationError('forbidden');
      const visible = projectManagementObservation(
        latest.context,
        found.data,
        facts,
      );
      if (!visible) throw new ObservationError('forbidden');
      return { observation: visible, replayed: true };
    }
    const record = await buildRecord(ports, tx, current, input);
    // Resolve every citation and its current scope before persisting any source-derived text.
    if (
      !projectManagementObservation(
        current.context,
        record,
        await sourceFacts(ports, tx, record),
      )
    )
      throw new ObservationError('forbidden');
    await ports.insertObservation(tx, record);
    await ports.saveOperation(
      tx,
      accountId,
      input.operationId,
      fingerprint,
      record.id,
    );
    await ports.audit(tx, accountId, record.id);
    const facts = await sourceFacts(ports, tx, record);
    const latest = await snapshot(ports, tx, accountId);
    if (!canCreateObservation(latest.context, input, input.origin))
      throw new ObservationError('forbidden');
    const visible = projectManagementObservation(latest.context, record, facts);
    if (!visible) throw new ObservationError('forbidden');
    return { observation: visible, replayed: false };
  });
}
async function buildRecord<Tx>(
  ports: ManagementObservationPorts<Tx>,
  tx: Tx,
  current: ObservationSnapshot,
  input: CreateObservationInput,
): Promise<ManagementObservation> {
  const common = {
    id: ports.allocateId(),
    evaluationNodeId: input.evaluationNodeId,
    personId: input.personId,
    text: input.text,
    origin: input.origin,
    kind: 'management-observation' as const,
    nature: 'management_observation' as const,
    sources: input.sources,
    recordedAt: current.context.now,
    recordedByAccountId: current.context.account.id,
  };
  const actor = {
    personId: current.context.account.personId,
    name: current.actorName,
  };
  if (input.origin === 'manual')
    return managementObservationSchema.parse({
      ...common,
      author: actor,
      authorUnconfirmed: false,
      importedBy: null,
      occurredAt: input.occurredAt,
      attributionId: null,
    });
  const parsed = interviewAttributionSchema.safeParse(
    await ports.loadAttribution(tx, input.attributionId),
  );
  if (!parsed.success) throw new ObservationError('invalid_source');
  const source = parsed.data;
  const refs = new Set(source.sources.map(referenceKey));
  if (
    source.id !== input.attributionId ||
    source.evaluationNodeId !== input.evaluationNodeId ||
    source.personId !== input.personId ||
    source.text !== input.text ||
    refs.size !== input.sources.length ||
    input.sources.some((ref) => !refs.has(referenceKey(ref))) ||
    (source.interviewer.personId !== null &&
      !current.context.people.some(
        (person) => person.id === source.interviewer.personId,
      ))
  )
    throw new ObservationError('invalid_source');
  return managementObservationSchema.parse({
    ...common,
    author: source.interviewer,
    authorUnconfirmed: true,
    importedBy: { ...actor, accountId: current.context.account.id },
    occurredAt: source.interviewedAt,
    attributionId: source.id,
  });
}
export async function readManagementObservations<Tx>(
  ports: ManagementObservationPorts<Tx>,
  accountId: string,
  raw: unknown,
): Promise<VisibleObservation[]> {
  const input = observationSubjectSchema.safeParse(raw);
  if (!input.success) throw new ObservationError('invalid_input');
  return ports.transaction(async (tx) => {
    const current = await snapshot(ports, tx, accountId);
    // Employee/expired relation gets no record/source lookup, including an author ID guess.
    if (!canCreateObservation(current.context, input.data, 'manual'))
      throw new ObservationError('forbidden');
    const candidates: {
      row: ManagementObservation;
      facts: ObservationSource[];
    }[] = [];
    for (const value of await ports.listObservations(tx, input.data)) {
      const row = managementObservationSchema.safeParse(value);
      if (!row.success) throw new ObservationError('invalid_data');
      if (
        row.data.personId !== input.data.personId ||
        row.data.evaluationNodeId !== input.data.evaluationNodeId ||
        !canReadObservation(current.context, row.data)
      )
        continue;
      // Load only already-authorized records' sources, before the FINAL current-context read.
      candidates.push({
        row: row.data,
        facts: await sourceFacts(ports, tx, row.data),
      });
    }
    const latest = await snapshot(ports, tx, accountId);
    if (!canCreateObservation(latest.context, input.data, 'manual'))
      throw new ObservationError('forbidden');
    // There is no asynchronous step after this authorization snapshot and projection.
    const refreshed = candidates.flatMap(({ row, facts }) => {
      const visible = projectManagementObservation(latest.context, row, facts);
      return visible ? [visible] : [];
    });
    return refreshed;
  });
}
