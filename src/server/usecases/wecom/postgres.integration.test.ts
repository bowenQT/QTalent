import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { createWecomNativeClient } from './native';
import { randomUUID } from 'node:crypto';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  nativeDatabase,
  seedNativeRules,
  seedNativeCase,
  syntheticBatchClient,
  businessAt,
  wallAt,
} from '../../../../tests/fixtures/bow-845/native';
import { createDatabase } from '../../db/client';
import { createRecordArrangeApplication } from '../record-arrange-application';
import { recordArrangeQueue } from '../../jobs/record-arrange';
import { wecomMessages, wecomReceiptAttempts } from '../../modules/records';
import { accountBindings, people } from '../../modules/directory';
import { evaluationRelations } from '../../modules/programs';
import { jobSnapshots } from '../../jobs/schema';
import { arrangeInputs } from '../../modules/records/arrange/input-state/schema';
import { describeWecomDelivery, describeWecomReceipt } from './message';
import { wecomBindings } from '../../auth/entry/schema';
import type { VerifiedWecomSender } from '../../auth/entry/persistent';
import { entryAccountBindingDigest } from '../../auth/entry/persistent';
import { parseWecomFrame } from '../../integrations/wecom/protocol';
import type { WecomBatchReceipt } from '../../integrations/wecom/receipts';
import { createWecomPostgresReceiver } from './postgres';

let c: Awaited<ReturnType<typeof nativeDatabase>>;
let boss: PgBoss;
beforeAll(async () => {
  c = await nativeDatabase();
  if (process.env.BOW_909_TEST_MIGRATIONS_DIR)
    await migrate(c.db, {
      migrationsFolder: process.env.BOW_909_TEST_MIGRATIONS_DIR,
    });
  await seedNativeRules(c.db);
  boss = new PgBoss({ connectionString: c.testUrl });
  boss.on('error', () => undefined);
  await boss.start();
  await boss.createQueue(recordArrangeQueue, { retryLimit: 0 });
}, 30000);
afterAll(async () => {
  await boss?.stop();
  await c?.close();
});
async function fixture(chatType: 'single' | 'group' = 'single') {
  const facts = await seedNativeCase(c.db);
  const model = syntheticBatchClient();
  const source: VerifiedWecomSender = {
    scope: 'demo-scope',
    botId: 'demo-bot',
    senderId: randomUUID(),
  };
  const credentialId = randomUUID();
  await c.db.insert(wecomBindings).values({
    id: credentialId,
    ...source,
    accountId: facts.account,
    accountBindingDigest: entryAccountBindingDigest(
      facts.account,
      facts.evaluator,
    ),
    revision: 1,
    expiresAt: new Date('2026-11-02'),
  });
  const frame = parseWecomFrame(
    JSON.stringify({
      cmd: 'aibot_msg_callback',
      headers: { req_id: randomUUID() },
      body: {
        msgid: randomUUID(),
        aibotid: source.botId,
        from: { userid: source.senderId },
        chattype: chatType,
        ...(chatType === 'group' ? { chatid: 'demo-group' } : {}),
        msgtype: 'text',
        text: { content: facts.text },
      },
    }),
    source,
  );
  if (frame.kind !== 'message') throw new Error('synthetic message required');
  const target = {
    evaluationNodeId: facts.node,
    personIds: [facts.target],
    projectId: facts.input.projectId,
  };
  const sent: WecomBatchReceipt[] = [];
  let proof = true,
    failSend = false,
    groupCalls = 0,
    proofCalls = 0;
  let beforeSend: (() => Promise<void>) | undefined;
  const appFor = (db = c.db) =>
    createRecordArrangeApplication({
      db,
      boss,
      client: model.client,
      businessNow: () => businessAt,
      now: () => new Date(wallAt),
    });
  const make = (db = c.db, verifiedSource = source) =>
    createWecomPostgresReceiver({
      db,
      requests: appFor(db).requests,
      now: () => new Date(wallAt),
      // Synthetic verified transport boundary only; the actual 903 reader/PG is used.
      verifiedSender: async () => {
        proofCalls++;
        return proof ? verifiedSource : null;
      },
      sender: {
        acknowledgeGroup: async () => {
          await beforeSend?.();
          groupCalls++;
        },
        sendPrivateReceipt: async (_message, receipt) => {
          await beforeSend?.();
          sent.push(receipt);
          if (failSend) throw new Error('synthetic ACK unknown');
        },
      },
    });
  return {
    ...facts,
    ...model,
    source,
    credentialId,
    message: frame.message,
    target,
    sent,
    app: appFor(),
    groupCalls: () => groupCalls,
    proofCalls: () => proofCalls,
    beforeSend: (run: () => Promise<void>) => {
      beforeSend = run;
    },
    receiver: make(),
    make,
    setProof: (value: boolean) => {
      proof = value;
    },
    failSend: () => {
      failSend = true;
    },
  };
}
it('commits a real message, intake and queue once, including replay from a fresh pool', async () => {
  const h = await fixture();
  const result = await h.receiver.receive(h.message, h.target);
  expect(result.status).toBe('accepted');
  const fresh = createDatabase(c.testUrl);
  try {
    expect(
      await h
        .make(fresh.db)
        .receive({ ...h.message, requestId: 'new-ack' }, h.target),
    ).toEqual({ ...result, replayed: true });
  } finally {
    await fresh.pool.end();
  }
  const rows = await c.db
    .select()
    .from(wecomMessages)
    .where(eq(wecomMessages.credentialId, h.credentialId));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    actorAccountId: h.account,
    actorPersonId: h.evaluator,
    credentialRevision: 1,
    evaluationNodeId: h.node,
    personIds: [h.target.personIds[0]],
    archiveRefs: [],
  });
  expect(rows[0]!.inputId).toBeTruthy();
  expect(rows[0]!.jobId).toBeTruthy();
  const jobs = await c.db.execute<{ n: number }>(
    sql`select count(*)::int n from pgboss.job where data->>'jobId' = ${rows[0]!.jobId}`,
  );
  expect(jobs.rows[0]!.n).toBe(1);
  expect(h.calls()).toBe(0);
});
it('reserves before send, acknowledges once, and does not resend from a new instance', async () => {
  const h = await fixture();
  await h.receiver.receive(h.message, h.target);
  h.beforeSend(async () => {
    const fresh = createDatabase(c.testUrl);
    try {
      const attempts = await fresh.db
        .select()
        .from(wecomReceiptAttempts)
        .where(
          eq(
            wecomReceiptAttempts.messageKey,
            describeWecomDelivery(h.message).key,
          ),
        );
      expect(attempts).toHaveLength(1);
      expect(attempts[0]!.state).toBe('reserved');
    } finally {
      await fresh.pool.end();
    }
  });
  expect(await h.receiver.deliver(h.message, 'private_receipt')).toEqual({
    status: 'acknowledged',
  });
  expect(await h.make().deliver(h.message, 'private_receipt')).toEqual({
    status: 'acknowledged',
  });
  expect(h.sent).toHaveLength(1);
  expect(Object.keys(h.sent[0]!).sort()).toEqual([
    'batchId',
    'revision',
    'status',
  ]);
  expect(h.sent[0]!.status).toBe('processing');
});
it('persists unknown ACK and never resends that reservation', async () => {
  const h = await fixture();
  await h.receiver.receive(h.message, h.target);
  h.failSend();
  expect(await h.receiver.deliver(h.message, 'private_receipt')).toEqual({
    status: 'outcome_unknown',
  });
  expect(await h.make().deliver(h.message, 'private_receipt')).toEqual({
    status: 'outcome_unknown',
  });
  expect(h.sent).toHaveLength(1);
});
it('rejects revoked credentials and invalid transport without another message or receipt', async () => {
  const h = await fixture();
  await h.receiver.receive(h.message, h.target);
  await c.db
    .update(wecomBindings)
    .set({ revokedAt: new Date(wallAt) })
    .where(eq(wecomBindings.id, h.credentialId));
  expect(await h.receiver.receive(h.message, h.target)).toEqual({
    status: 'unauthenticated',
  });
  expect(await h.receiver.deliver(h.message, 'private_receipt')).toEqual({
    status: 'unauthenticated',
  });
  expect(h.sent).toHaveLength(0);
  h.setProof(false);
  expect(await h.receiver.receive(h.message, h.target)).toEqual({
    status: 'unauthenticated',
  });
});
it('serializes concurrent receipt attempts and messages with the same stable identity', async () => {
  const h = await fixture();
  const created = await Promise.all([
    h.receiver.receive(h.message, h.target),
    h.make().receive(h.message, h.target),
  ]);
  expect(created.every((r) => r.status === 'accepted')).toBe(true);
  expect(
    created.filter((r) => r.status === 'accepted' && !r.replayed),
  ).toHaveLength(1);
  await Promise.all([
    h.receiver.deliver(h.message, 'private_receipt'),
    h.make().deliver(h.message, 'private_receipt'),
  ]);
  expect(h.sent).toHaveLength(1);
  const rows = await c.db
    .select()
    .from(wecomReceiptAttempts)
    .where(eq(wecomReceiptAttempts.batchId, h.sent[0]!.batchId));
  expect(rows).toHaveLength(1);
  expect(rows[0]!.state).toBe('acknowledged');
});
it('rejects payload or trusted-target changes on replay without another intake', async () => {
  const h = await fixture();
  await h.receiver.receive(h.message, h.target);
  const changed = {
    ...h.message,
    parts: [{ kind: 'text' as const, text: h.text + '修改（演示）' }],
  };
  expect(await h.receiver.receive(changed, h.target)).toEqual({
    status: 'conflict',
  });
  expect(
    await h.receiver.receive(h.message, {
      ...h.target,
      evaluationNodeId: h.otherNode,
    }),
  ).toEqual({ status: 'conflict' });
  const rows = await c.db
    .select()
    .from(arrangeInputs)
    .where(eq(arrangeInputs.creatorAccountId, h.account));
  expect(rows).toHaveLength(1);
  expect(h.calls()).toBe(0);
});
it('rejects unknown transport tuples rather than treating sender as an account', async () => {
  const h = await fixture();
  for (const changed of [
    { scope: 'other-scope' },
    { botId: 'other-bot' },
    { senderId: 'unknown' },
  ]) {
    const source = { ...h.message.source, ...changed };
    const { wecomMessageKey } =
      await import('../../integrations/wecom/protocol');
    source.messageKey = wecomMessageKey(
      source.scope,
      source.botId,
      source.messageId,
    );
    expect(
      await h.receiver.receive({ ...h.message, source }, h.target),
    ).toEqual({ status: 'unauthenticated' });
  }
  expect(
    await c.db
      .select()
      .from(wecomMessages)
      .where(eq(wecomMessages.credentialId, h.credentialId)),
  ).toHaveLength(0);
});
it('rejects directory rebind and expiry, and never reuses the old credential revision', async () => {
  const h = await fixture();
  await h.receiver.receive(h.message, h.target);
  await c.db
    .update(wecomBindings)
    .set({ revision: 2 })
    .where(eq(wecomBindings.id, h.credentialId));
  expect(await h.receiver.receive(h.message, h.target)).toEqual({
    status: 'not_found',
  });
  await c.db
    .update(accountBindings)
    .set({ personId: h.other })
    .where(eq(accountBindings.accountId, h.account));
  expect(await h.receiver.receive(h.message, h.target)).toEqual({
    status: 'unauthenticated',
  });
  await c.db
    .update(accountBindings)
    .set({ personId: h.evaluator })
    .where(eq(accountBindings.accountId, h.account));
  await c.db
    .update(wecomBindings)
    .set({ expiresAt: new Date(wallAt) })
    .where(eq(wecomBindings.id, h.credentialId));
  expect(await h.receiver.receive(h.message, h.target)).toEqual({
    status: 'unauthenticated',
  });
});
it('rechecks full domain permission on both message replay and receipt send', async () => {
  const h = await fixture();
  await h.receiver.receive(h.message, h.target);
  await c.db
    .update(evaluationRelations)
    .set({ validTo: businessAt })
    .where(eq(evaluationRelations.id, h.relation));
  expect(await h.receiver.receive(h.message, h.target)).toEqual({
    status: 'not_found',
  });
  expect(await h.receiver.deliver(h.message, 'private_receipt')).toEqual({
    status: 'not_found',
  });
  expect(h.sent).toHaveLength(0);
  expect(h.calls()).toBe(0);
});
it('checks revoked identity after an actual message lock wait', async () => {
  const h = await fixture();
  const key = describeWecomDelivery(h.message).key;
  const holder = await c.pool.connect();
  await holder.query('BEGIN');
  await holder.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
    'qtalent:wecom:message:' + key,
  ]);
  const waiting = h.receiver.receive(h.message, h.target);
  try {
    await expect
      .poll(
        async () => {
          const r = await c.pool.query(
            "select count(*)::int n from pg_locks where locktype='advisory' and granted=false and database=(select oid from pg_database where datname=current_database())",
          );
          return r.rows[0].n;
        },
        { timeout: 3000 },
      )
      .toBeGreaterThan(0);
    await c.db
      .update(wecomBindings)
      .set({ revokedAt: new Date(wallAt) })
      .where(eq(wecomBindings.id, h.credentialId));
  } finally {
    await holder.query('ROLLBACK');
    holder.release();
  }
  expect(await waiting).toEqual({ status: 'unauthenticated' });
  expect(
    await c.db.select().from(wecomMessages).where(eq(wecomMessages.key, key)),
  ).toHaveLength(0);
});
it('does not resend a committed reservation left by an interrupted process', async () => {
  const h = await fixture();
  const accepted = await h.receiver.receive(h.message, h.target);
  if (accepted.status !== 'accepted')
    throw new Error('accepted fixture required');
  const fact = describeWecomReceipt(accepted.messageKey, {
    kind: 'private_receipt',
    batchId: accepted.batchId,
    revision: 1,
    status: 'processing',
  });
  await c.db.insert(wecomReceiptAttempts).values({
    key: fact.key,
    messageKey: accepted.messageKey,
    kind: 'private_receipt',
    batchId: accepted.batchId,
    batchRevision: 1,
    batchStatus: 'processing',
    fingerprint: fact.fingerprint,
    state: 'reserved',
    attemptedAt: new Date(wallAt),
  });
  expect(await h.make().deliver(h.message, 'private_receipt')).toEqual({
    status: 'outcome_unknown',
  });
  expect(h.sent).toHaveLength(0);
});
it('group acknowledgement has its own durable null-batch key', async () => {
  const h = await fixture('group');
  await h.receiver.receive(h.message, h.target);
  expect(await h.receiver.deliver(h.message, 'group_ack')).toEqual({
    status: 'acknowledged',
  });
  expect(await h.make().deliver(h.message, 'group_ack')).toEqual({
    status: 'acknowledged',
  });
  expect(h.groupCalls()).toBe(1);
  const [row] = await c.db
    .select()
    .from(wecomReceiptAttempts)
    .where(
      eq(wecomReceiptAttempts.messageKey, describeWecomDelivery(h.message).key),
    );
  expect(row).toMatchObject({
    kind: 'group_ack',
    batchId: null,
    batchRevision: null,
    batchStatus: null,
  });
});
it('rolls producer sources and queue back when the real queue is unavailable', async () => {
  const h = await fixture();
  await boss.deleteQueue(recordArrangeQueue);
  try {
    expect(await h.receiver.receive(h.message, h.target)).toEqual({
      status: 'unavailable',
    });
    expect(
      await c.db
        .select()
        .from(wecomMessages)
        .where(eq(wecomMessages.credentialId, h.credentialId)),
    ).toHaveLength(0);
    expect(
      await c.db
        .select()
        .from(arrangeInputs)
        .where(eq(arrangeInputs.creatorAccountId, h.account)),
    ).toHaveLength(0);
  } finally {
    await boss.createQueue(recordArrangeQueue, { retryLimit: 0 });
  }
  expect((await h.receiver.receive(h.message, h.target)).status).toBe(
    'accepted',
  );
});
it('actual runner completes once and permits a distinct current-state receipt, without another model call on replay', async () => {
  const h = await fixture();
  await h.receiver.receive(h.message, h.target);
  expect(await h.receiver.deliver(h.message, 'private_receipt')).toEqual({
    status: 'acknowledged',
  });
  const [message] = await c.db
    .select()
    .from(wecomMessages)
    .where(eq(wecomMessages.credentialId, h.credentialId));
  const [job] = await c.db
    .select()
    .from(jobSnapshots)
    .where(eq(jobSnapshots.jobId, message!.jobId!));
  expect(await h.app.runner.run(job!.jobId, job!.attempt)).toBe(
    'awaiting_manual',
  );
  expect(h.calls()).toBe(1);
  expect(await h.receiver.deliver(h.message, 'private_receipt')).toEqual({
    status: 'acknowledged',
  });
  expect(h.sent.map((r) => r.status)).toEqual([
    'processing',
    'awaiting_confirmation',
  ]);
  expect(h.sent.map((receipt) => receipt.revision)).toEqual([1, 2]);
  expect((await h.make().receive(h.message, h.target)).status).toBe('accepted');
  await h.app.runner.run(job!.jobId, job!.attempt);
  expect(h.calls()).toBe(1);
  expect(await h.make().deliver(h.message, 'private_receipt')).toEqual({
    status: 'acknowledged',
  });
  expect(h.sent).toHaveLength(2);
});
it('isolates the same message ID across real scope, bot and sender bindings', async () => {
  const h = await fixture();
  await h.receiver.receive(h.message, h.target);
  const { wecomMessageKey } = await import('../../integrations/wecom/protocol');
  for (const changed of [
    { scope: 'demo-other-scope' },
    { botId: 'demo-other-bot' },
    { senderId: 'demo-other-sender' },
  ]) {
    const source = { ...h.source, ...changed };
    await c.db.insert(wecomBindings).values({
      id: randomUUID(),
      ...source,
      accountId: h.account,
      accountBindingDigest: entryAccountBindingDigest(h.account, h.evaluator),
      revision: 1,
      expiresAt: new Date('2026-11-02'),
    });
    const message = {
      ...h.message,
      source: {
        ...h.message.source,
        ...source,
        messageKey: wecomMessageKey(
          source.scope,
          source.botId,
          h.message.source.messageId,
        ),
      },
    };
    expect((await h.make(c.db, source).receive(message, h.target)).status).toBe(
      'accepted',
    );
  }
  expect(
    await c.db
      .select()
      .from(wecomMessages)
      .where(eq(wecomMessages.actorAccountId, h.account)),
  ).toHaveLength(4);
  expect(
    await c.db
      .select()
      .from(arrangeInputs)
      .where(eq(arrangeInputs.creatorAccountId, h.account)),
  ).toHaveLength(4);
});
it('requires explicit complete targets and refuses media without persisting a fake text input', async () => {
  const h = await fixture();
  expect(await h.receiver.receive(h.message, null)).toEqual({
    status: 'unavailable',
    reason: 'target_required',
  });
  expect(
    await h.receiver.receive(
      {
        ...h.message,
        parts: [
          {
            kind: 'file',
            url: 'https://media.example.test/demo',
            aesKey: 'synthetic',
          },
        ],
      },
      h.target,
    ),
  ).toEqual({ status: 'unavailable', reason: 'archive_required' });
  expect(
    await c.db
      .select()
      .from(wecomMessages)
      .where(eq(wecomMessages.credentialId, h.credentialId)),
  ).toHaveLength(0);
  expect(h.calls()).toBe(0);
});
it('revalidates current status for the real transport send gate', async () => {
  const h = await fixture();
  const r = await h.receiver.receive(h.message, h.target);
  if (r.status !== 'accepted') throw new Error('accepted fixture required');
  expect(
    await h.receiver.canSend(h.message, {
      kind: 'private_receipt',
      batchId: r.batchId,
      revision: 1,
      status: 'processing',
    }),
  ).toBe(true);
  expect(
    await h.receiver.canSend(h.message, {
      kind: 'private_receipt',
      batchId: r.batchId,
      revision: 1,
      status: 'awaiting_confirmation',
    }),
  ).toBe(false);
  expect(await h.receiver.canSend(h.message, { kind: 'group_ack' })).toBe(
    false,
  );
  h.setProof(false);
  expect(
    await h.receiver.canSend(h.message, {
      kind: 'private_receipt',
      batchId: r.batchId,
      revision: 1,
      status: 'processing',
    }),
  ).toBe(false);
});
async function wireFixture(
  hasTarget = true,
  existing?: Awaited<ReturnType<typeof fixture>>,
) {
  const h = existing ?? (await fixture('group'));
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('local server required');
  let peer: WebSocket | undefined;
  let holdPrivateAck = false;
  let afterGroup: (() => Promise<void>) | undefined;
  const frames: Array<{
    cmd: string;
    headers: { req_id: string };
    body?: Record<string, unknown>;
  }> = [];
  const errors: string[] = [];
  server.on('connection', (socket) => {
    peer = socket;
    socket.on('message', async (raw) => {
      const frame = JSON.parse(raw.toString()) as (typeof frames)[number];
      // Do not retain subscription credentials, even these synthetic bytes.
      if (frame.cmd !== 'aibot_subscribe') frames.push(frame);
      if (frame.cmd === 'aibot_send_msg' && holdPrivateAck) return;
      if (frame.cmd === 'aibot_respond_msg') await afterGroup?.();
      socket.send(
        JSON.stringify({
          headers: { req_id: frame.headers.req_id },
          errcode: 0,
        }),
      );
    });
  });
  const client = createWecomNativeClient(
    {
      ...h.source,
      secret: 'synthetic-local-only',
      webOrigin: 'https://demo.example.test',
      db: c.db,
      requests: h.app.requests,
      now: () => new Date(wallAt),
      resolveTarget: async () => (hasTarget ? h.target : null),
      onError: (error) => errors.push(error.kind),
      heartbeatMs: 30000,
      ackTimeoutMs: 1000,
    },
    { openSocket: () => new WebSocket(`ws://127.0.0.1:${address.port}`) },
  );
  await client.connect();
  function send(sender = h.source.senderId, ack = randomUUID()) {
    peer!.send(
      JSON.stringify({
        cmd: 'aibot_msg_callback',
        headers: { req_id: ack },
        body: {
          msgid: h.message.source.messageId,
          aibotid: h.source.botId,
          from: { userid: sender },
          chattype: 'group',
          chatid: 'demo-group',
          msgtype: 'text',
          text: { content: h.text },
        },
      }),
    );
  }
  return {
    ...h,
    socketClient: client,
    holdPrivateAck: () => {
      holdPrivateAck = true;
    },
    afterGroup: (run: () => Promise<void>) => {
      afterGroup = run;
    },
    frames,
    errors,
    send,
    async close() {
      await client.close();
      server.clients.forEach((s) => s.terminate());
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
it('uses an actual subscribed WS closure, real identity reader and native ledger through replay and clean shutdown', async () => {
  const h = await wireFixture();
  try {
    h.send();
    await expect
      .poll(() => h.frames.filter((f) => f.cmd === 'aibot_send_msg').length, {
        timeout: 5000,
      })
      .toBe(1);
    const group = h.frames.find((f) => f.cmd === 'aibot_respond_msg')!;
    expect(group.body).toEqual({
      msgtype: 'stream',
      stream: {
        id: expect.stringMatching(/^ack_/),
        finish: true,
        content: '收到了',
      },
    });
    const receipt = h.frames.find((f) => f.cmd === 'aibot_send_msg')!;
    expect(receipt.body).toMatchObject({
      chatid: h.source.senderId,
      msgtype: 'markdown',
    });
    expect(JSON.stringify(receipt.body)).not.toContain(h.evaluator);
    expect(JSON.stringify(receipt.body)).not.toContain(h.text);
    h.send();
    // Wait for the durable ACK before checking redelivery; no sleep-based success.
    await expect
      .poll(
        async () => {
          const rows = await c.db
            .select()
            .from(wecomReceiptAttempts)
            .where(
              eq(
                wecomReceiptAttempts.messageKey,
                describeWecomDelivery(h.message).key,
              ),
            );
          return rows.filter((r) => r.state === 'acknowledged').length;
        },
        { timeout: 5000 },
      )
      .toBe(2);
    h.send('unknown-demo-sender');
    await expect
      .poll(() => h.errors.includes('forbidden'), { timeout: 3000 })
      .toBe(true);
    expect(h.frames.filter((f) => f.cmd === 'aibot_send_msg')).toHaveLength(1);
    expect(
      await c.db
        .select()
        .from(wecomMessages)
        .where(eq(wecomMessages.actorAccountId, h.account)),
    ).toHaveLength(1);
  } finally {
    await h.close();
  }
  expect(h.socketClient.state).toBe('closed');
  const restarted = await wireFixture(true, h);
  try {
    restarted.send();
    restarted.send('unknown-demo-sender');
    await expect
      .poll(() => restarted.errors.includes('forbidden'), { timeout: 3000 })
      .toBe(true);
    expect(
      restarted.frames.filter(
        (f) => f.cmd === 'aibot_send_msg' || f.cmd === 'aibot_respond_msg',
      ),
    ).toHaveLength(0);
    expect(
      await c.db
        .select()
        .from(wecomMessages)
        .where(eq(wecomMessages.actorAccountId, h.account)),
    ).toHaveLength(1);
  } finally {
    await restarted.close();
  }
  // New native client has no old in-memory transport proof or send queue.
});
it('reports missing target from the real transport without acknowledging or enqueueing', async () => {
  const h = await wireFixture(false);
  try {
    h.send();
    await expect
      .poll(() => h.errors.includes('unavailable'), { timeout: 3000 })
      .toBe(true);
    expect(
      h.frames.filter(
        (f) => f.cmd === 'aibot_send_msg' || f.cmd === 'aibot_respond_msg',
      ),
    ).toHaveLength(0);
    expect(
      await c.db
        .select()
        .from(wecomMessages)
        .where(eq(wecomMessages.actorAccountId, h.account)),
    ).toHaveLength(0);
  } finally {
    await h.close();
  }
});
it('refuses a named co-subject outside the actual node before creating sources or ledger', async () => {
  const h = await fixture();
  const [other] = await c.db
    .select()
    .from(people)
    .where(eq(people.id, h.other));
  const message = {
    ...h.message,
    parts: [
      {
        kind: 'text' as const,
        text: h.text + ' ' + other!.name + '（共同材料演示）',
      },
    ],
  };
  expect(await h.receiver.receive(message, h.target)).toEqual({
    status: 'forbidden',
  });
  expect(
    await c.db
      .select()
      .from(arrangeInputs)
      .where(eq(arrangeInputs.creatorAccountId, h.account)),
  ).toHaveLength(0);
  expect(
    await c.db
      .select()
      .from(wecomMessages)
      .where(eq(wecomMessages.credentialId, h.credentialId)),
  ).toHaveLength(0);
  expect(h.calls()).toBe(0);
});
it('real WS ACK timeout remains unknown after a fresh connection and never sends again', async () => {
  const h = await wireFixture();
  try {
    h.holdPrivateAck();
    h.send();
    await expect
      .poll(
        async () => {
          const rows = await c.db
            .select()
            .from(wecomReceiptAttempts)
            .where(
              eq(
                wecomReceiptAttempts.messageKey,
                describeWecomDelivery(h.message).key,
              ),
            );
          return rows.find((r) => r.kind === 'private_receipt')?.state;
        },
        { timeout: 3000 },
      )
      .toBe('outcome_unknown');
    expect(h.frames.filter((f) => f.cmd === 'aibot_send_msg')).toHaveLength(1);
  } finally {
    await h.close();
  }
  const restarted = await wireFixture(true, h);
  try {
    restarted.send();
    await expect
      .poll(() => restarted.errors.includes('unavailable'), { timeout: 3000 })
      .toBe(true);
    expect(
      restarted.frames.filter((f) => f.cmd === 'aibot_send_msg'),
    ).toHaveLength(0);
  } finally {
    await restarted.close();
  }
});
it('revocation while the real group ACK is pending prevents the subsequent private send', async () => {
  const h = await wireFixture();
  try {
    h.afterGroup(async () => {
      await c.db
        .update(evaluationRelations)
        .set({ validTo: businessAt })
        .where(eq(evaluationRelations.id, h.relation));
    });
    h.send();
    await expect
      .poll(() => h.errors.includes('unavailable'), { timeout: 3000 })
      .toBe(true);
    expect(h.frames.filter((f) => f.cmd === 'aibot_respond_msg')).toHaveLength(
      1,
    );
    expect(h.frames.filter((f) => f.cmd === 'aibot_send_msg')).toHaveLength(0);
    const rows = await c.db
      .select()
      .from(wecomReceiptAttempts)
      .where(
        eq(
          wecomReceiptAttempts.messageKey,
          describeWecomDelivery(h.message).key,
        ),
      );
    expect(rows.map((r) => r.kind)).toEqual(['group_ack']);
  } finally {
    await h.close();
  }
});
it('rejects missing ledger and altered payload before reserving any receipt', async () => {
  const h = await fixture();
  expect(await h.receiver.deliver(h.message, 'private_receipt')).toEqual({
    status: 'not_found',
  });
  expect(await h.receiver.deliver(h.message, 'group_ack')).toEqual({
    status: 'validation_error',
  });
  expect(
    await h.receiver.canSend(h.message, {
      kind: 'private_receipt',
      batchId: 'missing-demo',
      revision: 1,
      status: 'processing',
    }),
  ).toBe(false);
  await h.receiver.receive(h.message, h.target);
  const changed = {
    ...h.message,
    parts: [{ kind: 'text' as const, text: '改动（演示）' }],
  };
  expect(await h.receiver.deliver(changed, 'private_receipt')).toEqual({
    status: 'conflict',
  });
  expect(
    await c.db
      .select()
      .from(wecomReceiptAttempts)
      .where(
        eq(
          wecomReceiptAttempts.messageKey,
          describeWecomDelivery(h.message).key,
        ),
      ),
  ).toHaveLength(0);
  expect(h.sent).toHaveLength(0);
});
