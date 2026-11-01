import { z } from 'zod';
export type EntryChannel = 'web' | 'wecom' | 'mcp' | 'agentapi';
export type CredentialBinding = {
  credentialId: string;
  accountId: string;
  personId: string;
  revision: number;
  expiresAt: string;
  revokedAt: string | null;
};
declare const identityBrand: unique symbol;
export type EntryIdentity = Readonly<{
  channel: EntryChannel;
  [identityBrand]: true;
}>;
export type EntryAuthenticator = {
  verify(presented: unknown): Promise<unknown>;
  current(credentialId: string): Promise<unknown>;
};
export class EntryIdentityError extends Error {
  constructor(readonly kind: 'unauthenticated' | 'unavailable') {
    super(kind);
    this.name = 'EntryIdentityError';
  }
}
const bindingSchema = z.strictObject({
  credentialId: z.string().min(1).max(200),
  accountId: z.string().min(1).max(200),
  personId: z
    .string()
    .min(1)
    .max(200)
    .refine((value) => value.trim().length > 0),
  revision: z.number().int().positive(),
  expiresAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().nullable(),
});
const channels: readonly string[] = ['web', 'wecom', 'mcp', 'agentapi'];
function active(value: unknown, now: number): CredentialBinding | null {
  const parsed = bindingSchema.safeParse(value);
  if (
    !parsed.success ||
    Date.parse(parsed.data.expiresAt) <= now ||
    (parsed.data.revokedAt !== null && Date.parse(parsed.data.revokedAt) <= now)
  )
    return null;
  return parsed.data;
}
function safeFailure(error: unknown): EntryIdentityError {
  return error instanceof EntryIdentityError
    ? error
    : new EntryIdentityError('unavailable');
}
/** Verifiers are installed by trusted server composition, never by a request.
 * This module issues only an in-process identity capability, not a personal token.
 */
export function createEntryIdentityService(
  authenticators: Partial<Record<EntryChannel, EntryAuthenticator>> = {},
  wallNow: () => Date = () => new Date(),
) {
  const issued = new WeakMap<
    EntryIdentity,
    {
      channel: EntryChannel;
      binding: CredentialBinding;
      reader: EntryAuthenticator;
    }
  >();
  function clock() {
    const value = wallNow().getTime();
    if (!Number.isFinite(value)) throw new EntryIdentityError('unavailable');
    return value;
  }
  return {
    async authenticate(
      channel: EntryChannel,
      presented: unknown,
    ): Promise<EntryIdentity> {
      try {
        if (
          !channels.includes(channel) ||
          presented === undefined ||
          presented === null
        )
          throw new EntryIdentityError('unauthenticated');
        const reader = authenticators[channel];
        if (!reader) throw new EntryIdentityError('unavailable');
        const binding = active(await reader.verify(presented), clock());
        if (!binding) throw new EntryIdentityError('unauthenticated');
        const identity = Object.freeze({ channel }) as EntryIdentity;
        // No presented credential/header/token is retained in the capability.
        issued.set(identity, { channel, binding, reader });
        return identity;
      } catch (error) {
        throw safeFailure(error);
      }
    },
    async current(identity: EntryIdentity): Promise<{
      accountId: string;
      personId: string;
      channel: EntryChannel;
      credentialId: string;
      credentialRevision: number;
    }> {
      try {
        const state =
          typeof identity === 'object' && identity !== null
            ? issued.get(identity)
            : undefined;
        if (!state || !active(state.binding, clock()))
          throw new EntryIdentityError('unauthenticated');
        // Retain the issuing channel's reader: equal row IDs in another issuer
        // cannot renew a revoked credential. Renewal does not extend this cap.
        const current = active(
          await state.reader.current(state.binding.credentialId),
          clock(),
        );
        if (
          !current ||
          current.accountId !== state.binding.accountId ||
          current.personId !== state.binding.personId ||
          current.credentialId !== state.binding.credentialId ||
          current.revision !== state.binding.revision ||
          issued.get(identity) !== state
        )
          throw new EntryIdentityError('unauthenticated');
        return {
          channel: state.channel,
          accountId: current.accountId,
          personId: current.personId,
          credentialId: current.credentialId,
          credentialRevision: current.revision,
        };
      } catch (error) {
        // Retire this capability even if the backing row is later restored.
        // A concurrent refresh must observe the same live issuance before return.
        issued.delete(identity);
        throw safeFailure(error);
      }
    },
  };
}
export type EntryIdentityService = ReturnType<
  typeof createEntryIdentityService
>;
