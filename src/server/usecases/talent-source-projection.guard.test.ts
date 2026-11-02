import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as projection from './talent-source-projection';

// Second line of defence behind the type system: every source read goes through
// completeTalentSources over a whole intake table. A new caller must be added here.
const root = join(process.cwd(), 'src');
const production = (
  readdirSync(root, { recursive: true, encoding: 'utf8' }) as string[]
)
  .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
  .map((file) => ({
    file: join('src', file).replaceAll('\\', '/'),
    text: readFileSync(join(root, file), 'utf8'),
  }));
const importing = (name: RegExp) =>
  production
    .filter(({ text }) =>
      [
        // Static imports and `const { x } = await import('...')`.
        ...text.matchAll(/import[^;]*?from\s+'[^']+'/gs),
        ...text.matchAll(/\{[^}]*\}\s*=\s*await import\('[^']+'\)/gs),
      ].some((match) => name.test(match[0])),
    )
    .map(({ file }) => file)
    .sort();

describe('complete talent source projection', () => {
  it('exports only the complete entry, never the raw graph or merge step', () => {
    expect(Object.keys(projection)).not.toEqual(
      expect.arrayContaining(['rawTalentSourceGraph']),
    );
    for (const name of [
      'rawTalentSourceGraph',
      'confirmationSources',
      'lockConfirmationIntakes',
      'talentSources',
    ])
      expect(projection).not.toHaveProperty(name);
  });

  it('keeps the intake merge step private to the projection module', () => {
    expect(importing(/record-confirmation-sources'/)).toEqual([
      'src/server/usecases/talent-source-projection.ts',
    ]);
  });

  it('builds intake tables from fixtures only in tests', () => {
    expect(importing(/\bintakeTableForTests\b/)).toEqual([
      'src/server/queries/person-test-helpers.ts',
    ]);
  });

  it('lists every production reader of the projection', () => {
    expect(importing(/\b(completeTalentSources|readIntakeTable)\b/)).toEqual([
      'src/server/queries/people.ts',
      'src/server/queries/person-data.ts',
      'src/server/queries/person-projection.ts',
      'src/server/queries/sources.ts',
      'src/server/usecases/record-arrange-context.ts',
      'src/server/usecases/record-batch-arrange-requests.ts',
      'src/server/usecases/record-batch-arrange-store.ts',
      'src/server/usecases/record-save.ts',
      'src/server/usecases/talent-export/policy.ts',
      'src/server/usecases/talent-export/postgres.ts',
    ]);
  });
});
