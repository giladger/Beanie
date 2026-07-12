import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const productionFiles = typescriptFiles(srcDir)
  .filter((file) => !file.startsWith(join(srcDir, 'test') + sep));
const productionFileSet = new Set(productionFiles);
const parsedFiles = productionFiles.map(parseFile);

const coordinatorOwner = 'runtime/gatewayMutationCoordinator.ts';
const physicalGatewayMutations = new Set([
  'updateWorkflow',
  'requestState',
  'updateCalibration',
  'updateMachineSettings',
  'updateMachineAdvancedSettings',
  'resetMachineSettings',
  'setRefillLevel'
]);

run('the low-level workflow scheduler has one concrete application owner', () => {
  const offenders: string[] = [];
  for (const parsed of parsedFiles) {
    const imports = workflowCoordinatorImports(parsed);
    if (imports.identifiers.size === 0 && imports.namespaces.size === 0) continue;
    visit(parsed.source, (node) => {
      if (!ts.isNewExpression(node)) return;
      const directInstantiation = ts.isIdentifier(node.expression) &&
        imports.identifiers.has(node.expression.text);
      const namespaceInstantiation = ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        imports.namespaces.has(node.expression.expression.text) &&
        node.expression.name.text === 'WorkflowCommandCoordinator';
      if ((directInstantiation || namespaceInstantiation) && parsed.path !== coordinatorOwner) {
        offenders.push(locationOf(parsed, node));
      }
    });
  }

  ok(
    offenders.length === 0,
    'instantiate WorkflowCommandCoordinator only in runtime/gatewayMutationCoordinator.ts; ' +
      `feature code must inject GatewayMutationPort instead:\n${offenders.join('\n')}`
  );
});

run('application feature code does not revive the legacy workflowCommands scheduler', () => {
  const offenders: string[] = [];
  for (const parsed of parsedFiles.filter(isFeatureCompositionFile)) {
    visit(parsed.source, (node) => {
      if (ts.isIdentifier(node) && node.text === 'workflowCommands') {
        offenders.push(locationOf(parsed, node));
      }
    });
  }

  ok(
    offenders.length === 0,
    'legacy workflowCommands bypasses the extracted gateway/machine authority; ' +
      `use gatewayMutations or MachineWorkflowCommands instead:\n${offenders.join('\n')}`
  );
});

run('app raw physical gateway mutations stay inside the machine transport adapter', () => {
  const app = requiredParsedFile('app.ts');
  const gatewayNames = namedImportLocalNames(app, 'api/gateway.ts', 'gateway');
  ok(
    gatewayNames.size === 1,
    'architecture guard expected app.ts to import one named gateway adapter; ' +
      `found ${gatewayNames.size}`
  );
  const adapterRanges: Array<{ start: number; end: number }> = [];
  visit(app.source, (node) => {
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'MachineWorkflowCommands'
    ) {
      const transport = node.arguments?.[1];
      if (transport && ts.isObjectLiteralExpression(transport)) {
        adapterRanges.push({ start: transport.getStart(app.source), end: transport.getEnd() });
      }
    }
  });

  ok(
    adapterRanges.length === 1,
    'app.ts must compose exactly one inline MachineWorkflowCommands transport object; ' +
      `found ${adapterRanges.length}`
  );

  const offenders: string[] = [];
  visit(app.source, (node) => {
    const start = node.getStart(app.source);
    // A direct object destructure has no property-access node, so guard that
    // second way of smuggling a physical mutation out of the adapter too.
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      ts.isIdentifier(node.initializer) &&
      gatewayNames.has(node.initializer.text)
    ) {
      for (const element of node.name.elements) {
        const destructuredName = element.propertyName && ts.isIdentifier(element.propertyName)
          ? element.propertyName.text
          : ts.isIdentifier(element.name) ? element.name.text : null;
        if (destructuredName && physicalGatewayMutations.has(destructuredName)) {
          const declarationInsideAdapter = adapterRanges.some(
            (range) => start >= range.start && node.getEnd() <= range.end
          );
          if (!declarationInsideAdapter) {
            offenders.push(`${locationOf(app, element)} gateway.${destructuredName} destructure`);
          }
        }
      }
    }

    const method = directGatewayMember(node, gatewayNames);
    if (!method || !physicalGatewayMutations.has(method)) return;
    const insideAdapter = adapterRanges.some((range) => start >= range.start && node.getEnd() <= range.end);
    if (!insideAdapter) offenders.push(`${locationOf(app, node)} gateway.${method}`);
  });

  ok(
    offenders.length === 0,
    'raw physical gateway calls in app.ts must be transport wiring only; ' +
      `invoke the typed OwnedMachineLane operation instead:\n${offenders.join('\n')}`
  );
});

run('controller flows depend on narrow host contracts, never app.ts or AppState', () => {
  const offenders = new Set<string>();
  for (const parsed of parsedFiles.filter((file) => file.path.startsWith('controllers/'))) {
    visit(parsed.source, (node) => {
      if (ts.isIdentifier(node) && node.text === 'AppState') {
        offenders.add(`${locationOf(parsed, node)} references whole AppState`);
      }
      const specifier = moduleSpecifierOf(node);
      if (specifier && resolveLocalModule(parsed.file, specifier.text) === join(srcDir, 'app.ts')) {
        offenders.add(`${locationOf(parsed, node)} imports app.ts`);
      }
    });
  }

  ok(
    offenders.size === 0,
    'controller hosts must declare feature snapshots/patches in controller contracts; ' +
      `move shared types out of app.ts and do not expose whole AppState:\n${[...offenders].join('\n')}`
  );
});

interface ParsedFile {
  readonly file: string;
  readonly path: string;
  readonly source: ts.SourceFile;
}

function parseFile(file: string): ParsedFile {
  return {
    file,
    path: relativePath(file),
    source: ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    )
  };
}

function workflowCoordinatorImports(parsed: ParsedFile): {
  identifiers: Set<string>;
  namespaces: Set<string>;
} {
  const identifiers = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of parsed.source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      resolveLocalModule(parsed.file, statement.moduleSpecifier.text) !==
        join(srcDir, 'runtime/workflowCommandCoordinator.ts')
    ) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
      continue;
    }
    for (const element of bindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;
      if (importedName === 'WorkflowCommandCoordinator' && !element.isTypeOnly) {
        identifiers.add(element.name.text);
      }
    }
  }
  return { identifiers, namespaces };
}

function directGatewayMember(node: ts.Node, gatewayNames: ReadonlySet<string>): string | null {
  if (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    gatewayNames.has(node.expression.text)
  ) return node.name.text;
  if (
    ts.isElementAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    gatewayNames.has(node.expression.text) &&
    node.argumentExpression &&
    ts.isStringLiteral(node.argumentExpression)
  ) return node.argumentExpression.text;
  return null;
}

function namedImportLocalNames(
  parsed: ParsedFile,
  targetPath: string,
  importedName: string
): Set<string> {
  const names = new Set<string>();
  for (const statement of parsed.source.statements) {
    const target = ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)
      ? resolveLocalModule(parsed.file, statement.moduleSpecifier.text)
      : null;
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !target ||
      relativePath(target) !== targetPath
    ) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if ((element.propertyName?.text ?? element.name.text) === importedName) names.add(element.name.text);
    }
  }
  return names;
}

function moduleSpecifierOf(node: ts.Node): ts.StringLiteral | null {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier &&
    ts.isStringLiteral(node.moduleSpecifier)
  ) return node.moduleSpecifier;
  if (
    ts.isImportTypeNode(node) &&
    ts.isLiteralTypeNode(node.argument) &&
    ts.isStringLiteral(node.argument.literal)
  ) return node.argument.literal;
  if (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword &&
    node.arguments.length === 1 &&
    ts.isStringLiteral(node.arguments[0]!)
  ) return node.arguments[0]!;
  return null;
}

function resolveLocalModule(importer: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(importer), specifier);
  const extensionless = base.replace(/\.(?:[cm]?js|jsx|tsx?)$/i, '');
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${extensionless}.ts`,
    `${extensionless}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx')
  ];
  return candidates.find((candidate) => productionFileSet.has(candidate)) ?? null;
}

function requiredParsedFile(path: string): ParsedFile {
  const parsed = parsedFiles.find((file) => file.path === path);
  if (!parsed) throw new Error(`Architecture guard could not find ${path}`);
  return parsed;
}

function isFeatureCompositionFile(file: ParsedFile): boolean {
  return file.path === 'app.ts' || file.path.startsWith('controllers/');
}

function visit(node: ts.Node, inspect: (node: ts.Node) => void): void {
  inspect(node);
  ts.forEachChild(node, (child) => visit(child, inspect));
}

function locationOf(parsed: ParsedFile, node: ts.Node): string {
  const { line } = parsed.source.getLineAndCharacterOfPosition(node.getStart(parsed.source));
  return `${parsed.path}:${line + 1}`;
}

function relativePath(file: string): string {
  return relative(srcDir, file).split(sep).join('/');
}

function typescriptFiles(dir: string): string[] {
  const output: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) output.push(...typescriptFiles(full));
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) output.push(resolve(full));
  }
  return output;
}

function run(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function ok(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
