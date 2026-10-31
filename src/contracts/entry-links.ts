import { z } from 'zod';

/** Lookup metadata only. These IDs grant no access and carry no source text. */
export const entryLinkTargetSchema = z.strictObject({
  kind: z.enum(['material_batch', 'staffing_demand']),
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/),
  expectedRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
export type EntryLinkTarget = z.infer<typeof entryLinkTargetSchema>;
const path = '/entry/open';
export function buildEntryDeepLink(target: EntryLinkTarget): string {
  const value = entryLinkTargetSchema.parse(target);
  const query = new URLSearchParams({
    kind: value.kind,
    id: value.id,
    expectedRevision: String(value.expectedRevision),
  });
  return `${path}?${query}`;
}
/** Accept only our exact relative, canonical URL; never a general redirect URL. */
export function parseEntryDeepLink(value: unknown): EntryLinkTarget | null {
  if (
    typeof value !== 'string' ||
    value.length > 1000 ||
    !value.startsWith(`${path}?`) ||
    /[\\\x00-\x20\x7f#]/.test(value)
  )
    return null;
  const url = new URL(value, 'https://entry.invalid');
  const keys = ['kind', 'id', 'expectedRevision'];
  if (
    url.pathname !== path ||
    [...url.searchParams.keys()].length !== keys.length ||
    keys.some((key) => url.searchParams.getAll(key).length !== 1)
  )
    return null;
  const result = entryLinkTargetSchema.safeParse({
    kind: url.searchParams.get('kind'),
    id: url.searchParams.get('id'),
    expectedRevision: Number(url.searchParams.get('expectedRevision')),
  });
  return result.success && buildEntryDeepLink(result.data) === value
    ? result.data
    : null;
}
export function safeEntryReturnTo(value: unknown): string {
  const target = parseEntryDeepLink(value);
  return target ? buildEntryDeepLink(target) : '/';
}
