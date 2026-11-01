import { z } from 'zod';

export const providerId = z.string().regex(/^[A-Za-z0-9_-]{3,120}$/);
export const sessionId = z.string().regex(/^ses(?:s)?_[A-Za-z0-9_-]{1,100}$/);
const textBlock = z.object({
  type: z.literal('text'),
  text: z.string().max(65536),
});
export const customTool = z.strictObject({
  type: z.literal('custom'),
  name: z.string().regex(/^[a-z][a-z0-9_]{1,79}$/),
  description: z.string().min(1).max(2000),
  input_schema: z.record(z.string(), z.unknown()),
});
export type CustomTool = z.infer<typeof customTool>;
export const outgoingEvent = z.union([
  z.strictObject({
    type: z.literal('user.message'),
    input: z.strictObject({ parts: z.array(textBlock).min(1).max(1) }),
  }),
  z.strictObject({
    type: z.literal('user.custom_tool_result'),
    custom_tool_use_id: providerId,
    content: z.array(textBlock).min(1).max(1),
  }),
  z.strictObject({ type: z.literal('user.interrupt') }),
]);
export type OutgoingEvent = z.infer<typeof outgoingEvent>;
const envelope = z.object({ id: providerId, type: z.string().max(80) });
const recognized = {
  'agent.custom_tool_use': envelope.extend({
    type: z.literal('agent.custom_tool_use'),
    name: z.string().max(80),
    input: z.unknown(),
  }),
  'agent.message': envelope.extend({
    type: z.literal('agent.message'),
    content: z.array(textBlock).max(16),
  }),
  'session.status_idle': envelope.extend({
    type: z.literal('session.status_idle'),
    stop_reason: z.object({
      type: z.enum([
        'end_turn',
        'requires_action',
        'interrupted',
        'budget_reached',
        'retries_exhausted',
      ]),
      event_ids: z.array(providerId).max(16).optional(),
    }),
  }),
} as const;
export type NativeEvent =
  | z.infer<(typeof recognized)[keyof typeof recognized]>
  | {
      id: string;
      type:
        | 'user.message'
        | 'user.custom_tool_result'
        | 'user.interrupt'
        | 'session.error'
        | 'session.status_terminated'
        | 'unsafe_tool'
        | 'ignored';
    };
/** Drop unknown telemetry and error contents at the supplier boundary. */
export function parseNativeEvent(raw: unknown): NativeEvent {
  const base = envelope.parse(raw);
  if (base.type === 'agent.custom_tool_use')
    return recognized[base.type].parse(raw);
  if (base.type === 'agent.message') return recognized[base.type].parse(raw);
  if (base.type === 'session.status_idle')
    return recognized[base.type].parse(raw);
  if (base.type === 'agent.tool_use' || base.type === 'agent.mcp_tool_use')
    return { id: base.id, type: 'unsafe_tool' };
  if (
    base.type === 'user.message' ||
    base.type === 'user.custom_tool_result' ||
    base.type === 'user.interrupt' ||
    base.type === 'session.error' ||
    base.type === 'session.status_terminated'
  )
    return { id: base.id, type: base.type };
  return { id: base.id, type: 'ignored' };
}
export function parseEventPage(raw: unknown) {
  const value = z
    .object({
      data: z.array(z.unknown()).max(100),
      next_page: z.string().min(1).max(500).nullable().optional(),
    })
    .parse(raw);
  return {
    events: value.data.map(parseNativeEvent),
    nextPage: value.next_page ?? null,
  };
}
