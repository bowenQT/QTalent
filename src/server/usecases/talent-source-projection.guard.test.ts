import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import * as projection from './talent-source-projection';
import { intakeTableOf } from './talent-source-projection.test-support';

// Second line of defence behind the type system: every source read goes through
// completeTalentSources over a whole intake table. A new caller must be added here.
const repo = process.cwd();
const ALL = '*';
/** Module specifiers a file imports, with the names it can reach from each.
 * Namespace, default, side-effect, `export *`, non-destructured dynamic import
 * and require reach every export, so they count as importing all of them. */
export function importsOf(
  file: string,
  text: string,
): { target: string; names: string[]; reexport?: true }[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: { target: string; names: string[]; reexport?: true }[] = [];
  const resolve = (specifier: string) =>
    specifier.startsWith('.')
      ? relative(repo, normalize(join(dirname(join(repo, file)), specifier)))
          .replaceAll('\\', '/')
          .replace(/\.tsx?$/, '')
      : specifier;
  const add = (
    node: ts.Expression | undefined,
    names: string[],
    reexport?: true,
  ) => {
    if (node && ts.isStringLiteralLike(node))
      found.push({
        target: resolve(node.text),
        names,
        ...(reexport ? { reexport } : {}),
      });
  };
  const bindingNames = (name: ts.BindingName): string[] =>
    ts.isObjectBindingPattern(name)
      ? name.elements.map((element) =>
          element.dotDotDotToken
            ? ALL
            : ((element.propertyName ?? element.name) as ts.Identifier).text,
        )
      : [ALL];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      add(
        node.moduleSpecifier,
        !clause || clause.name || (bindings && ts.isNamespaceImport(bindings))
          ? [ALL]
          : bindings && ts.isNamedImports(bindings)
            ? bindings.elements.map(
                (element) => (element.propertyName ?? element.name).text,
              )
            : [ALL],
      );
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      add(
        node.moduleSpecifier,
        node.exportClause && ts.isNamedExports(node.exportClause)
          ? node.exportClause.elements.map(
              (element) => (element.propertyName ?? element.name).text,
            )
          : [ALL],
        true,
      );
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    )
      add(node.moduleReference.expression, [ALL]);
    else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require'))
    ) {
      let parent: ts.Node = node.parent;
      while (
        ts.isAwaitExpression(parent) ||
        ts.isParenthesizedExpression(parent)
      )
        parent = parent.parent;
      add(
        node.arguments[0],
        ts.isVariableDeclaration(parent) ? bindingNames(parent.name) : [ALL],
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}
const production = (
  readdirSync(join(repo, 'src'), {
    recursive: true,
    encoding: 'utf8',
  }) as string[]
)
  .filter(
    (file) =>
      /\.[cm]?[jt]sx?$/.test(file) && !/\.test\.[cm]?[jt]sx?$/.test(file),
  )
  .map((file) => {
    const path = join('src', file).replaceAll('\\', '/');
    const imports = importsOf(path, readFileSync(join(repo, path), 'utf8'));
    return {
      file: path,
      imports,
      reexports: imports.filter((entry) => entry.reexport),
    };
  });
/** Files importing `names` from `target`, or from any module that re-exports
 * them from `target` (followed transitively). Re-exporting files are included. */
const importing = (target: string, names?: RegExp) => {
  const reaches = (entry: { names: string[] }) =>
    !names || entry.names.some((name) => name === ALL || names.test(name));
  const carriers = new Set([target]);
  for (let grew = true; grew;) {
    grew = false;
    for (const { file, reexports } of production) {
      const self = file.replace(/\.[cm]?[jt]sx?$/, '');
      if (
        !carriers.has(self) &&
        reexports.some((entry) => carriers.has(entry.target) && reaches(entry))
      ) {
        carriers.add(self);
        grew = true;
      }
    }
  }
  return production
    .filter(({ imports }) =>
      imports.some((entry) => carriers.has(entry.target) && reaches(entry)),
    )
    .map(({ file }) => file)
    .sort();
};
const PROJECTION = 'src/server/usecases/talent-source-projection';

describe('complete talent source projection', () => {
  it('exports only the complete entry, never the raw graph, merge step or a table constructor', () => {
    for (const name of [
      'rawTalentSourceGraph',
      'confirmationSources',
      'lockConfirmationIntakes',
      'talentSources',
      'intakeTableForTests',
      'IssuedIntakeTable',
    ])
      expect(projection).not.toHaveProperty(name);
  });

  it('keeps the intake merge step private to the projection module', () => {
    expect(
      importing('src/server/usecases/record-confirmation-sources'),
    ).toEqual(['src/server/usecases/talent-source-projection.ts']);
  });

  it('builds intake tables from in-memory rows only in test helpers', () => {
    expect(importing(`${PROJECTION}.test-support`)).toEqual([
      'src/server/queries/person-test-helpers.ts',
    ]);
  });

  it('lists every production reader of the projection', () => {
    expect(
      importing(
        PROJECTION,
        /^(completeTalentSources|readIntakeTable|lockIntakeTable|intakeRows)$/,
      ),
    ).toEqual([
      'src/server/queries/people.ts',
      'src/server/queries/person-data.ts',
      'src/server/queries/person-projection.ts',
      'src/server/queries/sources.ts',
      'src/server/usecases/record-arrange-context.ts',
      'src/server/usecases/record-batch-arrange-requests.ts',
      'src/server/usecases/record-batch-arrange-store.ts',
      'src/server/usecases/record-confirmation-sources.ts',
      'src/server/usecases/record-ledger.ts',
      'src/server/usecases/record-save.ts',
      'src/server/usecases/talent-export/policy.ts',
      'src/server/usecases/talent-export/postgres.ts',
      `${PROJECTION}.test-support.ts`,
    ]);
  });

  it.each([
    ['namespace import', `import * as p from './talent-source-projection';`],
    ['default import', `import p from './talent-source-projection';`],
    [
      'double quotes',
      `import { readIntakeTable } from "./talent-source-projection";`,
    ],
    [
      're-export',
      `export { readIntakeTable } from './talent-source-projection';`,
    ],
    ['export star', `export * from './talent-source-projection';`],
    [
      'aliased import',
      `import { readIntakeTable as r } from './talent-source-projection';`,
    ],
    ['dynamic import', `const p = await import('./talent-source-projection');`],
    [
      'destructured dynamic import',
      `const { readIntakeTable } = await import('./talent-source-projection');`,
    ],
    [
      'dynamic import expression',
      `void import('./talent-source-projection').then((p) => p);`,
    ],
    ['require', `const p = require('./talent-source-projection');`],
    ['import equals', `import p = require('./talent-source-projection');`],
    ['side-effect import', `import './talent-source-projection';`],
  ])('the guard sees a %s', (_, text) => {
    const found = importsOf('src/server/usecases/probe.ts', text);
    expect(found.map((entry) => entry.target)).toEqual([PROJECTION]);
    expect(
      found[0]!.names.some(
        (name) => name === ALL || name === 'readIntakeTable',
      ),
    ).toBe(true);
  });

  it('refuses intake tables not issued by readIntakeTable', async () => {
    const table = await intakeTableOf([]);
    expect(projection.intakeRows(table)).toEqual([]);
    const spread = { ...table, rows: [] };
    expect(() =>
      projection.intakeRows(spread as unknown as typeof table),
    ).toThrow();
    expect(() =>
      projection.intakeRows({ rows: [] } as unknown as typeof table),
    ).toThrow();
    expect(() =>
      projection.completeTalentSources({
        intake: spread,
      } as unknown as Parameters<typeof projection.completeTalentSources>[0]),
    ).toThrow();
  });

  it('freezes the issued rows so a caller cannot edit them in place', async () => {
    const rows = [{ id: 'demo-intake', sourceContexts: [{ subjects: [] }] }];
    const table = await intakeTableOf(
      rows as unknown as Parameters<typeof intakeTableOf>[0],
    );
    const issued = projection.intakeRows(table);
    expect(Object.isFrozen(issued)).toBe(true);
    expect(Object.isFrozen(issued[0]!.sourceContexts[0]!.subjects)).toBe(true);
    expect(() => (issued as unknown[]).push({})).toThrow();
    rows[0]!.id = 'changed';
    expect(issued[0]!.id).toBe('demo-intake');
  });
});
