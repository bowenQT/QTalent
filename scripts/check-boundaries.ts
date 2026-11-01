import { readdir, readFile } from 'node:fs/promises';
import { isBuiltin } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
function isNodeBuiltin(specifier: string): boolean {
  return isBuiltin(specifier);
}
export function checkImport(file: string, specifier: string): string | null {
  const target = specifier.startsWith('@/')
    ? `src/${specifier.slice(2)}`
    : specifier.startsWith('.')
      ? path.posix.normalize(
          path.posix.join(path.posix.dirname(file), specifier),
        )
      : specifier;
  const frontend = /^src\/(app|features|components)\//.test(file);
  if (
    frontend &&
    (/^(pg|pg-boss|drizzle-orm|better-auth)(?:[/:]|$)/.test(target) ||
      isNodeBuiltin(target))
  )
    return 'UI cannot import server runtime packages';
  if (/^src\/(contracts|lib)\//.test(file) && /^src\/server\//.test(target))
    return 'Shared contracts and utilities cannot import server implementation';
  if (frontend && target.startsWith('src/server/')) {
    const authRoute =
      file.startsWith('src/app/api/auth/') && target === 'src/server/auth/next';
    if (!authRoute && !/^src\/server\/(queries|actions)\//.test(target))
      return 'UI data access must use queries or actions';
  }
  if (
    file.startsWith('src/components/ui/') &&
    /^src\/(features|server|contracts)\//.test(target)
  )
    return 'UI primitives cannot depend on business code';
  const domain = file.match(/^src\/server\/modules\/([^/]+)\//)?.[1];
  const other = target.match(/^src\/server\/modules\/([^/]+)(?:\/(.*))?$/);
  if (
    domain &&
    other &&
    domain !== other[1] &&
    other[2] !== 'index' &&
    other[2] !== 'index.ts' &&
    other[2] !== undefined
  )
    return 'Cross-domain access must use index.ts';
  if (
    /^src\/server\/(modules|authz|db)\//.test(file) ||
    (file.startsWith('src/server/auth/') && !file.endsWith('/next.ts'))
  ) {
    if (target === 'server-only' || /^next(?:\/|$)/.test(target))
      return 'Reusable server core cannot depend on Next request runtime';
  }
  if (
    file.startsWith('src/server/integrations/') &&
    (/^src\/server\/(db|authz|modules)\//.test(target) ||
      /^(pg|pg-boss|drizzle-orm)(?:[/:]|$)/.test(target))
  )
    return 'Integration adapters cannot access database or authorization';
  if (
    (file.startsWith('src/worker/') && target.startsWith('src/app/')) ||
    (file.startsWith('src/app/') && target.startsWith('src/worker/'))
  )
    return 'Web and worker cannot import each other';
  return null;
}
async function files(directory: string): Promise<string[]> {
  return (
    await Promise.all(
      (await readdir(directory, { withFileTypes: true })).map(async (entry) => {
        const filename = `${directory}/${entry.name}`;
        return entry.isDirectory()
          ? files(filename)
          : /\.tsx?$/.test(filename) && !/\.test\.tsx?$/.test(filename)
            ? [filename]
            : [];
      }),
    )
  ).flat();
}
export function checkDomainSymbols(
  file: string,
  target: string,
  names: string[],
  tableNames: Set<string>,
): string | null {
  const sourceDomain = file.match(/^src\/server\/modules\/([^/]+)\//)?.[1];
  const targetDomain = target.match(/^src\/server\/modules\/([^/]+)/)?.[1];
  if (
    sourceDomain &&
    targetDomain &&
    sourceDomain !== targetDomain &&
    names.some((name) => name === '*' || tableNames.has(name))
  )
    return 'Cross-domain table access is reserved for usecases';
  return null;
}
/** Only FK column references inside a pgTable declaration may cross domain table boundaries. */
export function isForeignKeyOnlyImport(
  file: string,
  source: string,
  names: string[],
): boolean {
  if (!file.endsWith('/schema.ts') || names.includes('*')) return false;
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  let valid = true;
  const used = new Set<string>();
  const wanted = new Set(names);
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node)) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const specifier of bindings.elements)
          if (specifier.propertyName && wanted.has(specifier.propertyName.text))
            valid = false;
      }
      return;
    }
    if (ts.isIdentifier(node) && wanted.has(node.text)) {
      used.add(node.text);
      const column = node.parent;
      if (
        !ts.isPropertyAccessExpression(column) ||
        column.expression !== node
      ) {
        valid = false;
        return;
      }
      const parent = column.parent;
      const directReference =
        ts.isArrowFunction(parent) &&
        parent.body === column &&
        ts.isCallExpression(parent.parent) &&
        ts.isPropertyAccessExpression(parent.parent.expression) &&
        parent.parent.expression.name.text === 'references' &&
        parent.parent.arguments[0] === parent;
      const array = parent;
      const property = array.parent;
      const foreignColumns =
        ts.isArrayLiteralExpression(array) &&
        ts.isPropertyAssignment(property) &&
        ts.isIdentifier(property.name) &&
        property.name.text === 'foreignColumns' &&
        ts.isObjectLiteralExpression(property.parent) &&
        ts.isCallExpression(property.parent.parent) &&
        ts.isIdentifier(property.parent.parent.expression) &&
        property.parent.parent.expression.text === 'foreignKey';
      let ancestor: ts.Node | undefined = column.parent;
      while (
        ancestor &&
        !(
          ts.isCallExpression(ancestor) &&
          ts.isIdentifier(ancestor.expression) &&
          ancestor.expression.text === 'pgTable'
        )
      )
        ancestor = ancestor.parent;
      if (!(directReference || foreignColumns) || !ancestor) valid = false;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return valid && names.length > 0 && names.every((name) => used.has(name));
}
export async function checkBoundaries() {
  const errors: string[] = [];
  const sourceFiles = await files('src');
  const tableNames = new Set<string>();
  for (const schema of sourceFiles.filter((file) =>
    file.endsWith('/schema.ts'),
  )) {
    const ast = ts.createSourceFile(
      schema,
      await readFile(schema, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    for (const statement of ast.statements)
      if (ts.isVariableStatement(statement))
        for (const declaration of statement.declarationList.declarations)
          if (ts.isIdentifier(declaration.name))
            tableNames.add(declaration.name.text);
  }
  for (const file of sourceFiles) {
    const source = await readFile(file, 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const isClient = ast.statements.some(
      (node) =>
        ts.isExpressionStatement(node) &&
        ts.isStringLiteral(node.expression) &&
        node.expression.text === 'use client',
    );
    function visit(node: ts.Node) {
      let literal: ts.Node | undefined;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
        literal = node.moduleSpecifier;
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === 'require'))
      ) {
        literal = node.arguments[0];
        if (!literal || !ts.isStringLiteral(literal))
          errors.push(`${file}: dynamic import/require must use a static path`);
      }
      if (literal && ts.isStringLiteral(literal)) {
        const target = literal.text.startsWith('@/')
          ? `src/${literal.text.slice(2)}`
          : literal.text.startsWith('.')
            ? path.posix.normalize(
                path.posix.join(path.posix.dirname(file), literal.text),
              )
            : literal.text;
        let imported = ['*'];
        if (
          ts.isImportDeclaration(node) &&
          node.importClause?.namedBindings &&
          ts.isNamedImports(node.importClause.namedBindings)
        )
          imported = node.importClause.namedBindings.elements.map(
            (element) => (element.propertyName ?? element.name).text,
          );
        if (
          ts.isExportDeclaration(node) &&
          node.exportClause &&
          ts.isNamedExports(node.exportClause)
        )
          imported = node.exportClause.elements.map(
            (element) => (element.propertyName ?? element.name).text,
          );
        const symbolsError = checkDomainSymbols(
          file,
          target,
          imported,
          tableNames,
        );
        if (
          symbolsError &&
          !isForeignKeyOnlyImport(
            file,
            source,
            imported.filter((name) => name === '*' || tableNames.has(name)),
          )
        )
          errors.push(`${file}: ${literal.text}: ${symbolsError}`);
        const error = checkImport(file, literal.text);
        if (error) errors.push(`${file}: ${literal.text}: ${error}`);
        if (isClient && /(?:@\/|\.\.?\/).*server\/queries\//.test(literal.text))
          errors.push(
            `${file}: client components cannot import server queries`,
          );
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    if (
      file.startsWith('src/server/actions/') &&
      !source.match(/^[\s]*(?:'use server'|"use server")/)
    )
      errors.push(`${file}: action entry requires use server`);
  }
  return errors;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const errors = await checkBoundaries();
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else console.log('Architecture boundaries passed');
}
