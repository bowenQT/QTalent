import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase, type Database } from '../../../src/server/db/client';
import {
  organizations,
  people,
  accountBindings,
  grants,
} from '../../../src/server/modules/directory';
import {
  cohorts,
  enrollments,
  evaluationNodes,
  evaluationNodeSubjects,
  evaluationRelations,
} from '../../../src/server/modules/programs';
import {
  dimensions,
  anchors,
  ruleVersions,
  ruleVersionApplicability,
} from '../../../src/server/modules/evaluation-system';
import {
  createFakeModelinkMaas,
  type ModelinkMaasClient,
  type ModelinkStructuredInput,
} from '../../../src/server/integrations/maas';

export const businessAt = '2026-09-04T08:00:00.000Z';
export const wallAt = '2026-11-01T12:00:00.000Z';
export async function nativeDatabase() {
  const source = process.env.TEST_DATABASE_URL;
  if (!source)
    throw new Error('TEST_DATABASE_URL required; use only test-db.env');
  const url = new URL(source);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  )
    throw new Error('Only isolated approved loopback _test source allowed');
  const name =
    'qtalent_845_native_' + randomUUID().replaceAll('-', '') + '_test';
  const admin = new Pool({
    connectionString: source,
    connectionTimeoutMillis: 3000,
  });
  await admin.query('CREATE DATABASE "' + name + '"');
  url.pathname = '/' + name;
  const connection = createDatabase(url.toString());
  try {
    await migrate(connection.db, {
      migrationsFolder: 'src/server/db/migrations',
    });
    // Explicit local media combination only; default CI still uses formal SQL.
    if (process.env.QTALENT_MEDIA_TEST_MIGRATIONS)
      await migrate(connection.db, {
        migrationsFolder: process.env.QTALENT_MEDIA_TEST_MIGRATIONS,
      });
    return {
      ...connection,
      testUrl: url.toString(),
      async close() {
        await connection.pool.end();
        await admin.query('DROP DATABASE IF EXISTS "' + name + '"');
        await admin.end();
      },
    };
  } catch (error) {
    await connection.pool.end();
    await admin.query('DROP DATABASE IF EXISTS "' + name + '"');
    await admin.end();
    throw error;
  }
}
export async function seedNativeRules(db: Database) {
  await db.insert(dimensions).values({
    id: 'native-prof',
    name: '演示专业度',
    axis: 'prof',
    core: true,
  });
  await db.insert(ruleVersions).values([
    { id: 'rubric-v1', provenance: 'published' },
    { id: 'rubric-v2', provenance: 'published' },
    { id: 'xe-select-v1', provenance: 'published' },
  ]);
  await db.insert(ruleVersionApplicability).values([
    {
      periodId: '845-rubric-v1',
      versionId: 'rubric-v1',
      category: 'dimension_anchors',
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      effectiveUntil: new Date('2026-10-01T00:00:00Z'),
    },
    {
      periodId: '845-rubric-v2',
      versionId: 'rubric-v2',
      category: 'dimension_anchors',
      effectiveFrom: new Date('2026-10-01T00:00:00Z'),
      effectiveUntil: null,
    },
    {
      periodId: '845-selection',
      versionId: 'xe-select-v1',
      category: 'xe_selection',
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      effectiveUntil: null,
    },
  ]);
  await db.insert(anchors).values(
    [1, 2, 3, 4, 5].flatMap((value) => [
      {
        id: '845-old-' + value,
        dimensionId: 'native-prof',
        ruleVersionId: 'rubric-v1',
        value,
        text: '演示旧版锚点 ' + value,
      },
      {
        id: '845-new-' + value,
        dimensionId: 'native-prof',
        ruleVersionId: 'rubric-v2',
        value,
        text: '演示新版锚点 ' + value,
      },
    ]),
  );
}
export async function seedNativeCase(db: Database) {
  const prefix = 'demo-845-' + randomUUID();
  const targetName = '林舟（演示-' + prefix.slice(-8) + '）';
  const target = prefix + '-target',
    other = prefix + '-other',
    evaluator = prefix + '-evaluator';
  const account = prefix + '-account',
    outsiderAccount = prefix + '-outsider-account';
  const cohort = prefix + '-cohort',
    node = prefix + '-node',
    otherNode = prefix + '-other-node';
  await db
    .insert(organizations)
    .values({ id: prefix, name: '演示组织', shortName: '演示' });
  await db.insert(people).values([
    { id: target, name: targetName, organizationId: prefix, demo: true },
    {
      id: other,
      name: '许禾（演示）' + prefix,
      organizationId: prefix,
      demo: true,
    },
    {
      id: evaluator,
      name: '演示评价人' + prefix,
      organizationId: prefix,
      demo: true,
    },
  ]);
  await db.insert(accountBindings).values([
    { accountId: account, personId: evaluator, isSystemAdmin: false },
    { accountId: outsiderAccount, personId: other, isSystemAdmin: false },
  ]);
  await db.insert(cohorts).values({ id: cohort, name: '演示期次' });
  await db.insert(enrollments).values({
    id: prefix + '-enrollment',
    personId: target,
    cohortId: cohort,
    confirmed: true,
    validFrom: '2026-01-01',
  });
  await db.insert(grants).values({
    id: prefix + '-mentor',
    accountId: account,
    role: 'mentor',
    scope: 'cohort',
    cohortId: cohort,
    validFrom: '2026-01-01',
  });
  await db.insert(evaluationNodes).values([
    {
      id: node,
      name: '演示记录节点',
      kind: 'program_cohort',
      cohortId: cohort,
    },
    { id: otherNode, name: '演示另一节点', kind: 'defense', cohortId: cohort },
  ]);
  await db.insert(evaluationNodeSubjects).values([
    { evaluationNodeId: node, personId: target },
    { evaluationNodeId: otherNode, personId: other },
  ]);
  const relation = prefix + '-relation';
  await db.insert(evaluationRelations).values({
    id: relation,
    evaluationNodeId: node,
    personId: target,
    evaluatorId: evaluator,
    kind: 'evaluator',
    validFrom: '2026-01-01T00:00:00Z',
  });
  const text =
    '  ' +
    targetName +
    '补齐回滚步骤。另一次' +
    targetName +
    '记录边界触发条件。\n ';
  return {
    prefix,
    target,
    other,
    evaluator,
    account,
    outsiderAccount,
    cohort,
    node,
    otherNode,
    relation,
    text,
    input: {
      operationId: randomUUID(),
      evaluationNodeId: node,
      personIds: [target],
      projectId: null,
      text,
      files: [],
    },
  };
}
export function syntheticBatchClient(
  options: {
    before?: (
      input: ModelinkStructuredInput<Record<string, unknown>>,
    ) => Promise<void>;
    invalid?: boolean;
    twoEvents?: boolean;
    noSendFailure?: boolean;
  } = {},
) {
  let calls = 0;
  const client: ModelinkMaasClient = {
    async generateStructured(input) {
      calls++;
      await options.before?.(input);
      if (options.noSendFailure && calls === 1)
        return {
          ok: false,
          kind: 'network',
          retryable: true,
          metadata: {
            model: 'google/gemini-3.8-flash',
            promptVersion: input.promptVersion,
            attempts: 0,
            elapsedMs: 0,
          },
        };
      const raw = JSON.parse(
        input.messages.find((message) => message.role === 'user')!
          .content as string,
      );
      const source = raw.sources[0];
      const quotes = options.twoEvents
        ? ['补齐回滚步骤', '记录边界触发条件']
        : ['补齐回滚步骤'];
      const value = {
        events: quotes.map((quote, index) => ({
          eventKey: 'proposal-' + index,
          personIds: raw.personIds,
          sbi: {
            title: '演示事件' + index,
            situation: '',
            behavior: quote,
            impact: '',
          },
          evidence: [
            {
              reference: options.invalid
                ? { ...source.reference, fragmentId: 'foreign-fragment' }
                : source.reference,
              quote,
            },
          ],
          scores: raw.personIds.map((personId: string) => ({
            state: 'unknown',
            personId,
            dimensionId: raw.dimensions[0],
            reason: '演示离线模型不产生评分',
          })),
        })),
        similarGroups: [],
      };
      return createFakeModelinkMaas(value).generateStructured(input);
    },
  };
  return { client, calls: () => calls };
}
