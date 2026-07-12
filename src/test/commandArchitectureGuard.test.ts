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

run('application composition constructs exactly one gateway and one machine authority', () => {
  const expectations = [
    {
      target: 'runtime/gatewayMutationCoordinator.ts',
      exported: 'GatewayMutationCoordinator'
    },
    {
      target: 'controllers/machineWorkflowCommands.ts',
      exported: 'MachineWorkflowCommands'
    }
  ] as const;
  for (const expectation of expectations) {
    const locations = constructorLocations(expectation.target, expectation.exported);
    ok(
      locations.length === 1 && locations[0]?.startsWith('app.ts:'),
      `${expectation.exported} must be constructed exactly once in app.ts; found:\n` +
        locations.join('\n')
    );
  }
});

run('durable dose and shot deletion primitives have one production owner each', () => {
  const outboxes = constructorLocations('domain/mutationOutbox.ts', 'DurableMutationOutbox');
  ok(
    outboxes.length === 1 && outboxes[0]?.startsWith('controllers/doseMutationReconciler.ts:'),
    'DurableMutationOutbox must be constructed only by DoseMutationReconciler:\n' + outboxes.join('\n')
  );

  const calls = importedCallLocations(
    'controllers/shotMetadataController.ts',
    'executeShotDeletion'
  );
  ok(
    calls.length === 1 && calls[0]?.startsWith('controllers/shotDeletionFlow.ts:'),
    'executeShotDeletion must be called only by ShotDeletionFlow:\n' + calls.join('\n')
  );
});

run('startup discovers both mutation phases from one outbox snapshot', () => {
  const app = requiredParsedFile('app.ts');
  const counts = new Map<string, number>();
  visit(app.source, (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
    const receiver = node.expression.expression;
    if (
      !ts.isPropertyAccessExpression(receiver) ||
      receiver.name.text !== 'doseMutationReconciler'
    ) return;
    const method = node.expression.name.text;
    counts.set(method, (counts.get(method) ?? 0) + 1);
  });
  ok(
    counts.get('pendingWork') === 1 &&
      (counts.get('pendingAdjustments') ?? 0) === 0 &&
      counts.get('pendingShotDeleteReclaims') === 1,
    'app startup must use one pendingWork snapshot; the single source-only read belongs ' +
      'to ShotDeletionFlow recovery wiring'
  );
});

run('legacy controller singleton exceptions cannot spread to new flows', () => {
  const allowed = new Set([
    'controllers/derekFlow.ts',
    'controllers/profileEditorFlow.ts',
    'controllers/scannerFlow.ts'
  ]);
  const singletonTargets = new Set(['api/gateway.ts', 'domain/cache.ts']);
  const offenders: string[] = [];
  for (const parsed of parsedFiles.filter((file) => file.path.startsWith('controllers/'))) {
    for (const statement of parsed.source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const target = resolveLocalModule(parsed.file, statement.moduleSpecifier.text);
      if (!target || !singletonTargets.has(relativePath(target))) continue;
      if (!allowed.has(parsed.path)) {
        offenders.push(`${locationOf(parsed, statement)} imports ${relativePath(target)}`);
      }
    }
  }
  ok(
    offenders.length === 0,
    'inject gateway/cache capabilities into new controller flows; the three listed legacy ' +
      `exceptions are extraction debt only:\n${offenders.join('\n')}`
  );
});

run('legacy singleton controllers cannot acquire physical machine, stock, or deletion calls', () => {
  const forbidden = new Set([
    ...physicalGatewayMutations,
    'createBatch',
    'updateBatch',
    'deleteShot'
  ]);
  const offenders: string[] = [];
  for (const parsed of parsedFiles.filter((file) => file.path.startsWith('controllers/'))) {
    const gatewayNames = namedImportLocalNames(parsed, 'api/gateway.ts', 'gateway');
    if (gatewayNames.size === 0) continue;
    visit(parsed.source, (node) => {
      const method = directGatewayMember(node, gatewayNames);
      if (method && forbidden.has(method)) offenders.push(`${locationOf(parsed, node)} gateway.${method}`);
    });
  }
  ok(
    offenders.length === 0,
    'physical gateway capabilities belong to typed composition owners, never legacy singleton flows:\n' +
      offenders.join('\n')
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

run('bean inventory mutations do not split back into legacy per-batch lanes', () => {
  const offenders: string[] = [];
  for (const parsed of parsedFiles) {
    visit(parsed.source, (node) => {
      const text = ts.isStringLiteralLike(node)
        ? node.text
        : ts.isTemplateExpression(node)
          ? node.head.text
          : null;
      if (text?.startsWith('batch:')) offenders.push(locationOf(parsed, node));
    });
  }

  ok(
    offenders.length === 0,
    'batch edits, split freezes, migrations, and dose deductions must share ' +
      `beanInventoryMutationKey(beanId):\n${offenders.join('\n')}`
  );
});

run('app batch writes are injected into inventory owners or use the canonical bean lane', () => {
  const app = requiredParsedFile('app.ts');
  const gatewayNames = namedImportLocalNames(app, 'api/gateway.ts', 'gateway');
  const batchMethods = new Set(['createBatch', 'updateBatch']);
  const ownerConstructors = new Set(['BeanInventoryController', 'DoseMutationReconciler']);
  const offenders: string[] = [];

  visit(app.source, (node) => {
    const method = directGatewayMember(node, gatewayNames);
    if (!method || !batchMethods.has(method)) return;
    if (hasOwningConstructor(node, ownerConstructors) || hasCanonicalInventoryLane(node)) return;
    offenders.push(`${locationOf(app, node)} gateway.${method}`);
  });

  ok(
    offenders.length === 0,
    'raw batch writes must be ports injected into BeanInventoryController/' +
      'DoseMutationReconciler or callbacks owned by ' +
      `runExactCommand(beanInventoryMutationKey(beanId), ...):\n${offenders.join('\n')}`
  );
});

run('app shot deletion transport is injected only into the shot deletion owner', () => {
  const app = requiredParsedFile('app.ts');
  const gatewayNames = namedImportLocalNames(app, 'api/gateway.ts', 'gateway');
  const calls: string[] = [];
  const offenders: string[] = [];

  visit(app.source, (node) => {
    if (directGatewayMember(node, gatewayNames) !== 'deleteShot') return;
    calls.push(locationOf(app, node));
    if (
      !hasOwningConstructor(node, new Set(['ShotDeletionFlow'])) ||
      !hasExactShotLane(node)
    ) {
      offenders.push(locationOf(app, node));
    }
  });

  ok(
    calls.length === 1 && offenders.length === 0,
    'gateway.deleteShot must appear exactly once in ShotDeletionFlow wiring and ' +
      `the canonical shot:<id> exact lane; found ${calls.length} call(s), bypasses:\n${offenders.join('\n')}`
  );
});

run('app batch collection reads stay in the inventory owner or canonical bean lane', () => {
  const app = requiredParsedFile('app.ts');
  const gatewayNames = namedImportLocalNames(app, 'api/gateway.ts', 'gateway');
  const calls: string[] = [];
  const offenders: string[] = [];
  visit(app.source, (node) => {
    if (directGatewayMember(node, gatewayNames) !== 'batches') return;
    calls.push(locationOf(app, node));
    if (
      !hasOwningConstructor(node, new Set(['BeanInventoryController'])) &&
      !hasCanonicalInventoryLane(node)
    ) offenders.push(locationOf(app, node));
  });
  ok(
    calls.length === 3 && offenders.length === 0,
    'gateway batch collection reads must be injected into BeanInventoryController or enter ' +
      'runExactCommand(beanInventoryMutationKey(beanId)); ' +
      `found ${calls.length} call(s), bypasses:\n${offenders.join('\n')}`
  );
});

run('bean inventory contract and policy internals stay behind the facade', () => {
  const offenders: string[] = [];
  for (const parsed of parsedFiles) {
    for (const statement of parsed.source.statements) {
      const specifier = moduleSpecifierOf(statement);
      if (!specifier) continue;
      const target = resolveLocalModule(parsed.file, specifier.text);
      if (!target) continue;
      const targetPath = relativePath(target);
      const allowed = targetPath === 'controllers/beanInventoryContract.ts'
        ? parsed.path === 'controllers/beanInventoryController.ts' ||
          parsed.path === 'controllers/beanInventoryPolicy.ts'
        : targetPath === 'controllers/beanInventoryPolicy.ts'
          ? parsed.path === 'controllers/beanInventoryController.ts'
          : true;
      if (!allowed) offenders.push(`${locationOf(parsed, statement)} imports ${targetPath}`);
    }
  }
  ok(
    offenders.length === 0,
    'feature consumers must import the BeanInventoryController facade, not its contract/policy internals:\n' +
      offenders.join('\n')
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

function constructorLocations(targetPath: string, exportedName: string): string[] {
  const locations: string[] = [];
  for (const parsed of parsedFiles) {
    const bindings = importedBindings(parsed, targetPath, exportedName);
    if (bindings.identifiers.size === 0 && bindings.namespaces.size === 0) continue;
    visit(parsed.source, (node) => {
      if (!ts.isNewExpression(node)) return;
      const direct = ts.isIdentifier(node.expression) && bindings.identifiers.has(node.expression.text);
      const namespaced = ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        bindings.namespaces.has(node.expression.expression.text) &&
        node.expression.name.text === exportedName;
      if (direct || namespaced) locations.push(locationOf(parsed, node));
    });
  }
  return locations;
}

function importedCallLocations(targetPath: string, exportedName: string): string[] {
  const locations: string[] = [];
  for (const parsed of parsedFiles) {
    const bindings = importedBindings(parsed, targetPath, exportedName);
    visit(parsed.source, (node) => {
      if (!ts.isCallExpression(node)) return;
      const direct = ts.isIdentifier(node.expression) && bindings.identifiers.has(node.expression.text);
      const namespaced = ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        bindings.namespaces.has(node.expression.expression.text) &&
        node.expression.name.text === exportedName;
      if (direct || namespaced) locations.push(locationOf(parsed, node));
    });
  }
  return locations;
}

function importedBindings(
  parsed: ParsedFile,
  targetPath: string,
  exportedName: string
): { identifiers: Set<string>; namespaces: Set<string> } {
  const identifiers = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of parsed.source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const target = resolveLocalModule(parsed.file, statement.moduleSpecifier.text);
    if (!target || relativePath(target) !== targetPath) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
      continue;
    }
    for (const element of bindings.elements) {
      if ((element.propertyName?.text ?? element.name.text) === exportedName && !element.isTypeOnly) {
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

function hasOwningConstructor(node: ts.Node, names: ReadonlySet<string>): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (
      ts.isNewExpression(current) &&
      ts.isIdentifier(current.expression) &&
      names.has(current.expression.text)
    ) return true;
  }
  return false;
}

function hasCanonicalInventoryLane(node: ts.Node): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (!ts.isCallExpression(current) || current.arguments.length < 2) continue;
    const method = current.expression;
    if (!ts.isPropertyAccessExpression(method) || method.name.text !== 'runExactCommand') continue;
    const key = current.arguments[0];
    return key != null &&
      ts.isCallExpression(key) &&
      ts.isIdentifier(key.expression) &&
      key.expression.text === 'beanInventoryMutationKey';
  }
  return false;
}

function hasExactShotLane(node: ts.Node): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (!ts.isCallExpression(current) || current.arguments.length < 2) continue;
    const method = current.expression;
    if (!ts.isPropertyAccessExpression(method) || method.name.text !== 'runExactCommand') continue;
    const key = current.arguments[0];
    return Boolean(
      key &&
      ((ts.isTemplateExpression(key) && key.head.text === 'shot:') ||
        (ts.isStringLiteralLike(key) && key.text.startsWith('shot:')))
    );
  }
  return false;
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
