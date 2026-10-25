import { describe, expect, it } from 'vitest';
import { checkImport, checkDomainSymbols } from './check-boundaries';
describe('architectural boundaries', () => {
  it('rejects UI database and auth internals through alias or resolved paths', () => {
    expect(
      checkImport('src/features/projects/Projects.tsx', '@/server/db/client'),
    ).toBeTruthy();
    expect(
      checkImport('src/app/page.tsx', '../server/modules/staffing/index'),
    ).toBeTruthy();
    expect(
      checkImport('src/components/ui/Button.tsx', '@/contracts/projects'),
    ).toBeTruthy();
  });
  it('rejects direct server packages and integration database clients', () => {
    expect(
      checkImport('src/features/projects/Projects.tsx', 'node:fs'),
    ).toBeTruthy();
    expect(
      checkImport('src/server/integrations/maas/index.ts', 'pg'),
    ).toBeTruthy();
  });
  it('allows query/action gateways and auth route adapter', () => {
    expect(
      checkImport(
        'src/app/(desk)/projects/page.tsx',
        '@/server/queries/projects',
      ),
    ).toBeNull();
    expect(
      checkImport(
        'src/features/projects/Projects.tsx',
        '@/server/actions/projects',
      ),
    ).toBeNull();
    expect(
      checkImport('src/app/api/auth/[...all]/route.ts', '@/server/auth/next'),
    ).toBeNull();
  });
  it('blocks cross-domain internals and Next dependencies in reusable server core', () => {
    expect(
      checkImport(
        'src/server/modules/staffing/index.ts',
        '../directory/schema',
      ),
    ).toBeTruthy();
    expect(
      checkImport('src/server/modules/staffing/index.ts', '../directory/index'),
    ).toBeNull();
    expect(
      checkImport('src/server/auth/index.ts', 'next/headers'),
    ).toBeTruthy();
    expect(checkImport('src/server/db/client.ts', 'server-only')).toBeTruthy();
    expect(
      checkImport(
        'src/server/integrations/maas/index.ts',
        '@/server/db/client',
      ),
    ).toBeTruthy();
    expect(checkImport('src/worker/index.ts', '@/app/page')).toBeTruthy();
  });
});

it('rejects cross-domain raw tables and namespace imports even through public index', () => {
  const tables = new Set(['people']);
  expect(
    checkDomainSymbols(
      'src/server/modules/staffing/index.ts',
      'src/server/modules/directory/index',
      ['people'],
      tables,
    ),
  ).toBeTruthy();
  expect(
    checkDomainSymbols(
      'src/server/modules/staffing/index.ts',
      'src/server/modules/directory/index',
      ['*'],
      tables,
    ),
  ).toBeTruthy();
  expect(
    checkDomainSymbols(
      'src/server/modules/staffing/index.ts',
      'src/server/modules/directory/index',
      ['readDirectory'],
      tables,
    ),
  ).toBeNull();
});

it('allows schema table imports only in declarative foreign keys through public domain entry', async () => {
  const { isForeignKeyOnlyImport } = await import('./check-boundaries');
  expect(
    isForeignKeyOnlyImport(
      'src/server/modules/records/schema.ts',
      `import { people } from '../directory'; export const events = pgTable('events', { personId: text('person_id').references(() => people.id) });`,
      ['people'],
    ),
  ).toBe(true);
  expect(
    isForeignKeyOnlyImport(
      'src/server/modules/records/index.ts',
      `export const x = pgTable('x', { personId: text('id').references(() => people.id) });`,
      ['people'],
    ),
  ).toBe(false);
  expect(
    isForeignKeyOnlyImport(
      'src/server/modules/records/schema.ts',
      `export const x = db.select().from(people);`,
      ['people'],
    ),
  ).toBe(false);
  expect(
    isForeignKeyOnlyImport(
      'src/server/modules/records/schema.ts',
      `export const x = people;`,
      ['people'],
    ),
  ).toBe(false);
  expect(
    isForeignKeyOnlyImport(
      'src/server/modules/records/schema.ts',
      `export const x = pgTable('x', {}, t => [foreignKey({ columns:[t.personId],foreignColumns:[people.id] })]);`,
      ['people'],
    ),
  ).toBe(true);
  expect(
    isForeignKeyOnlyImport(
      'src/server/modules/records/schema.ts',
      `export const x = pgTable('x', {}, t => [foreignKey({ columns:[people.id],foreignColumns:[t.id] })]);`,
      ['people'],
    ),
  ).toBe(false);
  expect(
    checkImport('src/server/modules/records/schema.ts', '../directory/schema'),
  ).toBeTruthy();
});
it('does not exempt renamed or unused table imports', async () => {
  const { isForeignKeyOnlyImport } = await import('./check-boundaries');
  expect(
    isForeignKeyOnlyImport(
      'src/server/modules/records/schema.ts',
      `import {people as p} from '../directory'; db.select().from(p);`,
      ['people'],
    ),
  ).toBe(false);
  expect(
    isForeignKeyOnlyImport(
      'src/server/modules/records/schema.ts',
      `import {people as p} from '../directory'; export const e=pgTable('e',{p:text('p').references(()=>p.id)});`,
      ['people'],
    ),
  ).toBe(false);
  expect(
    isForeignKeyOnlyImport(
      'src/server/modules/records/schema.ts',
      `import {people} from '../directory'; export const unused=1;`,
      ['people'],
    ),
  ).toBe(false);
});
