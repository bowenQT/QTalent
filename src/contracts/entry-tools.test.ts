import { describe, expect, it } from 'vitest';
import {
  MCP_ENTRY_TOOLS,
  AGENTAPI_ENTRY_TOOLS,
  ENTRY_TOOL_CHANNELS,
  ENTRY_TOOL_PERMISSIONS,
  entryToolInputSchemas,
  entryToolSuccessSchemas,
  entryToolFailureSchema,
  entryToolNameSchema,
  entryPayloadMatchesInput,
} from './entry-tools';
import { staffingFixture, staffingDemandJobFixture } from './staffing.fixtures';
import { buildEntryDeepLink } from './entry-links';

describe('entry tool trust contracts', () => {
  it('fixes MCP to three tools and AgentAPI to the nine three-act capabilities', () => {
    expect(MCP_ENTRY_TOOLS).toEqual([
      'record_moment',
      'person_brief',
      'draft_requirement',
    ]);
    expect(AGENTAPI_ENTRY_TOOLS).toHaveLength(9);
    expect(ENTRY_TOOL_CHANNELS.wecom).toEqual([
      'record_moment',
      'submit_material_batch',
      'read_material_batch',
    ]);
    expect(ENTRY_TOOL_PERMISSIONS.person_brief).toBe('person:brief');
    for (const action of [
      'confirm_score',
      'confirm_requirement',
      'confirm',
      'publish_rule',
      'attribute',
      'reassign',
      'delete',
    ])
      expect(entryToolNameSchema.safeParse(action).success).toBe(false);
  });
  it('rejects caller-supplied identity, roles and confirmation fields', () => {
    expect(
      entryToolInputSchemas.person_brief.safeParse({
        id: 'demo-person',
        role: 'hr',
      }).success,
    ).toBe(false);
    expect(
      entryToolInputSchemas.record_moment.safeParse({
        operationId: 'demo',
        evaluationNodeId: 'demo-node',
        personIds: [],
        text: '演示',
        files: [],
        accountId: 'admin',
      }).success,
    ).toBe(false);
    expect(
      entryToolInputSchemas.draft_requirement.safeParse({
        operationId: 'demo',
        projectId: 'demo-project',
        inputText: '演示',
        confirm: true,
      }).success,
    ).toBe(false);
  });
  it('has no successful unknown JSON slot for unfrozen third-act reads', () => {
    expect('read_comparison_summary' in entryToolSuccessSchemas).toBe(false);
    expect('read_revision_status' in entryToolSuccessSchemas).toBe(false);
    expect(
      entryToolInputSchemas.read_comparison_summary.parse({ batchId: 'demo' }),
    ).toEqual({ batchId: 'demo' });
    expect(
      entryToolInputSchemas.read_revision_status.safeParse({
        revisionId: 'demo',
        expectedRevision: 0,
      }).success,
    ).toBe(false);
  });
  it('projects demand status without input text, requirements or human identity', () => {
    expect(
      entryToolSuccessSchemas.read_requirement_status.parse(
        staffingFixture().demand,
      ),
    ).toEqual({ demandId: 'demo-demand', revision: 1, status: 'confirmed' });
    expect(
      entryToolSuccessSchemas.read_requirement_status.safeParse({
        status: 'confirmed',
      }).success,
    ).toBe(false);
  });
  it('never accepts an ActionResult failure or raw request as a success payload', () => {
    const unsafe = {
      status: 'validation_error',
      fieldErrors: {},
      input: { text: 'private' },
    };
    for (const schema of Object.values(entryToolSuccessSchemas))
      expect(schema.safeParse(unsafe).success).toBe(false);
    expect(entryToolFailureSchema.parse({ status: 'unavailable' })).toEqual({
      status: 'unavailable',
    });
    expect(
      entryToolFailureSchema.safeParse({ status: 'unavailable', input: unsafe })
        .success,
    ).toBe(false);
    expect(
      entryToolFailureSchema.safeParse({
        status: 'forbidden',
        message: 'private',
      }).success,
    ).toBe(false);
  });
  it('binds all successful payload identities and versions to authorized input', () => {
    const receipt = {
      batchId: 'demo-batch',
      revision: 1,
      evaluationNodeId: 'demo-node',
      personIds: [],
      files: [],
      status: 'processing' as const,
      jobId: 'demo-job',
    };
    expect(
      entryPayloadMatchesInput(
        'record_moment',
        { evaluationNodeId: 'demo-node' },
        receipt,
      ),
    ).toBe(true);
    expect(
      entryPayloadMatchesInput(
        'submit_material_batch',
        { evaluationNodeId: 'other' },
        receipt,
      ),
    ).toBe(false);
    expect(
      entryPayloadMatchesInput(
        'read_material_batch',
        { batchId: 'other' },
        receipt,
      ),
    ).toBe(false);
    const page = staffingFixture();
    expect(
      entryPayloadMatchesInput(
        'read_match_results',
        { demandId: 'demo-demand', expectedRevision: 1 },
        page,
      ),
    ).toBe(true);
    expect(
      entryPayloadMatchesInput(
        'read_match_results',
        { demandId: 'demo-demand', expectedRevision: 2 },
        page,
      ),
    ).toBe(false);
    expect(
      entryPayloadMatchesInput(
        'read_requirement_status',
        { demandId: 'demo-demand', expectedRevision: 1 },
        { demandId: 'demo-demand', revision: 1, status: 'confirmed' },
      ),
    ).toBe(true);
    const job = staffingDemandJobFixture();
    expect(
      entryPayloadMatchesInput(
        'draft_requirement',
        { projectId: 'demo-project' },
        job,
      ),
    ).toBe(true);
    job.result = page.demand;
    expect(
      entryPayloadMatchesInput(
        'draft_requirement',
        { projectId: 'other' },
        job,
      ),
    ).toBe(false);
    const target = {
      kind: 'material_batch' as const,
      id: 'demo-batch',
      expectedRevision: 1,
    };
    expect(
      entryPayloadMatchesInput('web_entry', target, {
        href: buildEntryDeepLink(target),
      }),
    ).toBe(true);
    expect(
      entryPayloadMatchesInput(
        'web_entry',
        { ...target, id: 'other' },
        { href: buildEntryDeepLink(target) },
      ),
    ).toBe(false);
    expect(
      entryPayloadMatchesInput('read_comparison_summary', {}, receipt),
    ).toBe(false);
  });
});
