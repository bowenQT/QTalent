import type { Database } from '../../db/client';
import { createEntryIdentityService } from '../../auth/entry/identity';
import { createWecomEntryAuthenticator } from '../../auth/entry/persistent';
import {
  createWecomClient,
  type WecomClientOptions,
} from '../../integrations/wecom/client';
import { WecomError } from '../../integrations/wecom/protocol';
import type {
  WecomMessage,
  WecomSource,
} from '../../integrations/wecom/protocol';
import type { WecomReceiptFact } from './message';
import {
  createWecomPostgresReceiver,
  type WecomPostgresDependencies,
} from './postgres';

type Options = Omit<
  WecomClientOptions,
  'authorize' | 'onMessage' | 'resolvePersistedReceipt'
> & {
  db: Database;
  requests: WecomPostgresDependencies['requests'];
  now(): Date;
  /** Server-owned facts from a confirmed target, never inferred from sender.
   * Null/incomplete target is explicitly unavailable. No default target. */
  resolveTarget(message: WecomMessage, signal: AbortSignal): Promise<unknown>;
};
/** The sole bridge from verified live WS callbacks to native persistence.
 * Worker registration/lifecycle remains X1-owned. This creates no connection
 * until connect() is explicitly called and reads no environment variables. */
export function createWecomNativeClient(
  options: Options,
  io?: Parameters<typeof createWecomClient>[1],
) {
  const connection = Object.freeze({
    scope: options.scope,
    botId: options.botId,
  });
  let pendingPersisted: string | undefined;
  const proofs = new WeakMap<WecomMessage, AbortSignal>();
  let pendingSend:
    { message: WecomMessage; fact: WecomReceiptFact } | undefined;
  let tail: Promise<unknown> = Promise.resolve();
  const pendingReceives = new Set<Promise<unknown>>();
  const verified = (message: WecomMessage) => {
    const signal = proofs.get(message);
    return signal && !signal.aborted && client.state === 'ready'
      ? {
          scope: message.source.scope,
          botId: message.source.botId,
          senderId: message.source.senderId,
        }
      : null;
  };
  function serializedSend(
    message: WecomMessage,
    fact: WecomReceiptFact,
    send: () => Promise<void>,
  ) {
    const next = tail.then(async () => {
      pendingSend = { message, fact };
      try {
        await send();
      } finally {
        pendingSend = undefined;
      }
    });
    tail = next.catch(() => undefined);
    return next;
  }
  const receiver = createWecomPostgresReceiver({
    db: options.db,
    requests: options.requests,
    now: options.now,
    verifiedSender: async (message) => verified(message),
    notifications: {
      connection: () => (client.state === 'ready' ? connection : null),
      send: (key) => {
        const next = tail.then(async () => {
          pendingPersisted = key;
          try {
            await client.sendPersistedReceipt(key);
          } finally {
            pendingPersisted = undefined;
          }
        });
        tail = next.catch(() => undefined);
        return next;
      },
    },
    sender: {
      acknowledgeGroup: (message) =>
        serializedSend(message, { kind: 'group_ack' }, () =>
          client.acknowledgeGroup(message),
        ),
      sendPrivateReceipt: (message, receipt) =>
        serializedSend(message, { kind: 'private_receipt', ...receipt }, () =>
          client.sendPrivateReceipt(message, receipt),
        ),
    },
  });
  async function knownSender(source: WecomSource) {
    const identities = createEntryIdentityService(
      {
        wecom: createWecomEntryAuthenticator(
          options.db,
          async () =>
            client.state === 'ready'
              ? {
                  scope: source.scope,
                  botId: source.botId,
                  senderId: source.senderId,
                }
              : null,
          options.now,
        ),
      },
      options.now,
    );
    const identity = await identities.authenticate('wecom', source);
    await identities.current(identity);
  }
  const client: ReturnType<typeof createWecomClient> = createWecomClient(
    {
      ...options,
      resolvePersistedReceipt: async (key, actualConnection) => {
        if (
          key !== pendingPersisted ||
          client.state !== 'ready' ||
          actualConnection.scope !== connection.scope ||
          actualConnection.botId !== connection.botId
        )
          return null;
        return receiver.resolvePersistedReceipt(key);
      },
      authorize: async (source, action) => {
        try {
          // This callback is reachable only through the installed client. Neither
          // it nor the private receiver is returned as a request-callable API.
          if (action.kind === 'receive') {
            await knownSender(source);
            return true;
          }
          const pending = pendingSend;
          if (
            !pending ||
            pending.message.source !== source ||
            !verified(pending.message)
          )
            return false;
          if (action.kind !== pending.fact.kind) return false;
          return receiver.canSend(pending.message, pending.fact);
        } catch {
          return false;
        }
      },
      onMessage: (message, signal) => {
        proofs.set(message, signal);
        const task = (async () => {
          const target = await options.resolveTarget(message, signal);
          const received = await receiver.receive(message, target);
          if (signal.aborted) return;
          if (received.status !== 'accepted')
            throw new WecomError(
              received.status === 'unauthenticated' ||
                received.status === 'forbidden' ||
                received.status === 'not_found'
                ? 'forbidden'
                : 'unavailable',
            );
          let uncertain = false;
          if (message.source.chatType === 'group') {
            const group = await receiver.deliver(message, 'group_ack');
            uncertain = group.status !== 'acknowledged';
          }
          if (!signal.aborted) {
            const receipt = await receiver.deliver(message, 'private_receipt');
            uncertain ||= !['acknowledged', 'not_applicable'].includes(
              receipt.status,
            );
          }
          if (uncertain && !signal.aborted) throw new WecomError('unavailable');
        })();
        pendingReceives.add(task);
        return task.finally(() => {
          pendingReceives.delete(task);
        });
      },
    },
    io,
  );
  return {
    connect: client.connect,
    notifyPending(after?: string) {
      const task = receiver.notifyPending(after);
      pendingReceives.add(task);
      return task.finally(() => {
        pendingReceives.delete(task);
      });
    },
    get state() {
      return client.state;
    },
    async close() {
      await client.close();
      await Promise.allSettled([...pendingReceives]);
      await tail;
    },
  };
}
