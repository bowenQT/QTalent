import { expect, it } from 'vitest';
import {
  sessionAuthority,
  assertSameAuthority,
  inspectNativeTurn,
  availableAgentTools,
} from './session-policy';
import type { NativeEvent } from '../../integrations/agentapi/protocol';
import type { EvaluationAuthzContext } from '../../authz/evaluation-node';

const actor = {
  channel: 'agentapi' as const,
  accountId: 'demo-account',
  personId: 'demo-person',
  credentialId: 'demo-binding',
  credentialRevision: 1,
};
function context(): EvaluationAuthzContext {
  return {
    account: {
      id: actor.accountId,
      personId: actor.personId,
      isSystemAdmin: false,
    },
    now: '2026-11-01T12:00:00Z',
    grants: [
      {
        accountId: actor.accountId,
        role: 'manager',
        scope: 'company',
        cohortId: null,
        validFrom: '2026-01-01T00:00:00Z',
        validTo: '2026-12-01T00:00:00Z',
        revokedAt: null,
      },
    ],
    people: [
      { id: 'demo-person', noReview: false },
      { id: 'demo-other', noReview: false },
    ],
    enrollments: [],
    assignments: [],
    members: [],
    projects: [],
    evaluationNodes: [],
    evaluationNodeSubjects: [],
    evaluationRelations: [],
  };
}
const input: NativeEvent = { id: 'evt_user', type: 'user.message' };
const call: NativeEvent = {
  id: 'evt_tool',
  type: 'agent.custom_tool_use',
  name: 'person_brief',
  input: { id: 'demo-person' },
};
const idle: NativeEvent = {
  id: 'evt_idle',
  type: 'session.status_idle',
  stop_reason: { type: 'end_turn' },
};
const requiring: NativeEvent = {
  id: 'evt_require',
  type: 'session.status_idle',
  stop_reason: { type: 'requires_action', event_ids: ['evt_tool'] },
};
const answer: NativeEvent = {
  id: 'evt_answer',
  type: 'agent.message',
  content: [{ type: 'text', text: '演示建议，待人工确认。' }],
};
const observe = (events: NativeEvent[], completed: string[] = []) =>
  inspectNativeTurn(events, input.id, new Set(completed));
it('keeps authority stable for row ordering and time passing within the same validity interval', () => {
  const before = sessionAuthority(actor, context()),
    after = context();
  after.people.reverse();
  after.now = '2026-11-01T12:01:00Z';
  expect(() =>
    assertSameAuthority(before, sessionAuthority(actor, after)),
  ).not.toThrow();
});
it.each(['role', 'expiry', 'revocation', 'subject', 'noReview'] as const)(
  'invalidates cached model context after actual %s facts change',
  (change) => {
    const before = sessionAuthority(actor, context()),
      after = context();
    if (change === 'role') after.grants[0]!.role = 'hr';
    if (change === 'expiry') after.now = '2026-12-01T00:00:00Z';
    if (change === 'revocation') after.grants[0]!.revokedAt = after.now;
    if (change === 'subject')
      after.evaluationNodeSubjects.push({
        evaluationNodeId: 'demo-node',
        personId: 'demo-person',
      });
    if (change === 'noReview') after.people[0]!.noReview = true;
    expect(() =>
      assertSameAuthority(before, sessionAuthority(actor, after)),
    ).toThrow('permission_changed');
  },
);
it('separates accounts, bindings and credential revisions instead of trusting roles alone', () => {
  const old = sessionAuthority(actor, context());
  expect(() =>
    assertSameAuthority(old, { ...old, accountId: 'other' }),
  ).toThrow('permission_changed');
  expect(() =>
    assertSameAuthority(old, { ...old, credentialId: 'another' }),
  ).toThrow('permission_changed');
  expect(() =>
    assertSameAuthority(old, { ...old, credentialRevision: 2 }),
  ).toThrow('permission_changed');
  expect(() =>
    sessionAuthority({ ...actor, channel: 'mcp' }, context()),
  ).toThrow('permission_changed');
  expect(() =>
    sessionAuthority({ ...actor, personId: 'other' }, context()),
  ).toThrow('permission_changed');
  expect(() =>
    sessionAuthority(actor, { ...context(), now: 'invalid' }),
  ).toThrow('permission_changed');
});
it('ignores historical idle and duplicate replay before the accepted input', () => {
  expect(observe([idle, answer])).toEqual({ status: 'waiting' });
  expect(
    observe([idle, input, input, answer, { ...idle, id: 'evt_new_idle' }]),
  ).toEqual({
    status: 'complete',
    text: '演示建议，待人工确认。',
    nature: 'ai_suggestion',
  });
});
it('waits for requires_action and suppresses already completed tool events on replay', () => {
  expect(observe([input, call])).toEqual({ status: 'waiting' });
  expect(observe([input, call, requiring])).toEqual({
    status: 'tools',
    calls: [
      { id: 'evt_tool', name: 'person_brief', args: { id: 'demo-person' } },
    ],
  });
  expect(observe([input, call, requiring], ['evt_tool'])).toEqual({
    status: 'waiting',
  });
  expect(
    observe([input, call, requiring, answer, idle], ['evt_tool']).status,
  ).toBe('complete');
});
it.each([
  'missing',
  'duplicate',
  'earlyComplete',
  'changedId',
  'newUser',
  'wrongAck',
] as const)('refuses %s event inconsistencies', (kind) => {
  let events: NativeEvent[] = [input, call, requiring];
  if (kind === 'missing') events = [input, requiring];
  if (kind === 'duplicate')
    events = [
      input,
      call,
      {
        ...requiring,
        stop_reason: {
          type: 'requires_action',
          event_ids: ['evt_tool', 'evt_tool'],
        },
      },
    ];
  if (kind === 'earlyComplete') events = [input, call, idle];
  if (kind === 'changedId') events = [input, { id: input.id, type: 'ignored' }];
  if (kind === 'newUser')
    events = [input, { id: 'evt_other_user', type: 'user.message' }];
  if (kind === 'wrongAck') events = [{ id: input.id, type: 'ignored' }];
  expect(() => observe(events)).toThrow('protocol');
});
it.each([
  'user.interrupt',
  'session.error',
  'session.status_terminated',
  'unsafe_tool',
] as const)('does not expose generated text after %s', (type) => {
  expect(() =>
    observe([input, answer, { id: 'evt_error', type }, idle]),
  ).toThrow();
});
it.each(['interrupted', 'budget_reached', 'retries_exhausted'] as const)(
  'maps %s to a stopped result, never successful idle',
  (type) => {
    expect(() =>
      observe([input, answer, { ...idle, stop_reason: { type } }]),
    ).toThrow();
  },
);
it('does not advertise or execute unfrozen third-act DTOs or human confirmation operations', () => {
  expect(availableAgentTools).not.toContain('read_comparison_summary');
  expect(availableAgentTools).not.toContain('read_revision_status');
  for (const name of [
    'confirm_score',
    'read_comparison_summary',
    'read_revision_status',
  ])
    expect(() => observe([input, { ...call, name }])).toThrow('unavailable');
  expect(() =>
    observe([input, { ...call, input: { id: 'demo', actorId: 'admin' } }]),
  ).toThrow('protocol');
});
it('enforces bounded replay, tool count and answer length', () => {
  expect(() =>
    observe(
      Array.from({ length: 501 }, (_, i) => ({
        id: 'evt_' + i,
        type: 'ignored',
      })),
    ),
  ).toThrow('budget');
  expect(() =>
    observe([
      input,
      ...Array.from({ length: 9 }, (_, i) => ({
        ...call,
        id: 'evt_tool_' + i,
      })),
    ]),
  ).toThrow('budget');
  expect(() =>
    observe([
      input,
      { ...answer, content: [{ type: 'text', text: 'x'.repeat(65537) }] },
      idle,
    ]),
  ).toThrow('budget');
});

it('does not reuse a terminal observation when later output has not reached its own stop', () => {
  expect(observe([input, idle, answer])).toEqual({ status: 'waiting' });
  expect(observe([input, idle, call])).toEqual({ status: 'waiting' });
});
