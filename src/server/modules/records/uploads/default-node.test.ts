import { describe, expect, it } from 'vitest';
import type { EvaluationRelation } from '../../../authz/evaluation-node';
import { resolveDefaultIntakeNode } from './default-node';

const now = '2026-09-04T08:00:00Z';
function relation(
  evaluationNodeId: string,
  validFrom: string,
  values: Partial<EvaluationRelation> = {},
): EvaluationRelation {
  return {
    id: `${evaluationNodeId}-${validFrom}`,
    evaluationNodeId,
    evaluatorId: 'demo-mentor',
    personId: 'demo-person',
    kind: 'mentor',
    validFrom,
    validTo: null,
    revokedAt: null,
    ...values,
  };
}
const resolve = (
  relations: EvaluationRelation[],
  canWrite: (nodeId: string) => boolean = () => true,
) =>
  resolveDefaultIntakeNode(
    {
      account: {
        id: 'demo-account',
        personId: 'demo-mentor',
        isSystemAdmin: false,
      },
      evaluationRelations: relations,
      now,
    },
    canWrite,
  );

describe('default intake node', () => {
  it('picks the writable node whose current relation started last', () => {
    expect(
      resolve([
        relation('demo-node-a', '2026-03-01T00:00:00Z'),
        relation('demo-node-b', '2026-06-01T00:00:00Z'),
        relation('demo-node-a', '2026-02-01T00:00:00Z'),
      ]),
    ).toEqual({ status: 'resolved', evaluationNodeId: 'demo-node-b' });
  });

  it('ignores relations of others, ended or revoked relations and unwritable nodes', () => {
    expect(
      resolve(
        [
          relation('demo-node-a', '2026-03-01T00:00:00Z'),
          relation('demo-node-b', '2026-08-01T00:00:00Z', {
            evaluatorId: 'demo-other',
          }),
          relation('demo-node-c', '2026-08-01T00:00:00Z', {
            validTo: '2026-09-01T00:00:00Z',
          }),
          relation('demo-node-d', '2026-08-01T00:00:00Z', {
            revokedAt: '2026-08-02T00:00:00Z',
          }),
          relation('demo-node-e', '2026-10-01T00:00:00Z'),
          relation('demo-node-f', '2026-08-01T00:00:00Z'),
        ],
        (nodeId) => nodeId !== 'demo-node-f',
      ),
    ).toEqual({ status: 'resolved', evaluationNodeId: 'demo-node-a' });
  });

  it('reports equal latest starts as ambiguous and no candidate as missing', () => {
    expect(
      resolve([
        relation('demo-node-a', '2026-06-01T00:00:00Z'),
        relation('demo-node-b', '2026-06-01T00:00:00Z'),
        relation('demo-node-c', '2026-01-01T00:00:00Z'),
      ]),
    ).toEqual({ status: 'default_node_ambiguous' });
    expect(resolve([])).toEqual({ status: 'default_node_missing' });
    expect(
      resolve([relation('demo-node-a', '2026-06-01T00:00:00Z')], () => false),
    ).toEqual({ status: 'default_node_missing' });
  });
});
