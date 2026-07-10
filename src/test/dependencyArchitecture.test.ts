import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import {
  ALLOWED_LAYER_DEPENDENCIES,
  ARCHITECTURE_LAYERS,
  DEPENDENCY_DEBT,
  type ArchitectureLayer
} from '../architecture/dependencyPolicy';

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = typescriptFiles(srcDir).filter((file) => !file.startsWith(join(srcDir, 'test') + sep));
const fileSet = new Set(files);
const edges: DependencyEdge[] = [];

for (const file of files) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  collectEdges(source, file);
}

run('production imports obey the executable layer dependency policy', () => {
  const debtByEdge = new Map<string, (typeof DEPENDENCY_DEBT)[number]>();
  const duplicateDebt: string[] = [];
  for (const debt of DEPENDENCY_DEBT) {
    const key = edgeKey(debt.from, debt.to);
    if (debtByEdge.has(key)) duplicateDebt.push(key);
    debtByEdge.set(key, debt);
  }

  const usedDebt = new Set<string>();
  const offenders: string[] = [];
  for (const edge of uniqueEdges(edges)) {
    const allowed = ALLOWED_LAYER_DEPENDENCIES[edge.fromLayer].includes(edge.toLayer);
    if (allowed) continue;
    const key = edgeKey(edge.from, edge.to);
    const debt = debtByEdge.get(key);
    if (debt) {
      usedDebt.add(key);
      continue;
    }
    offenders.push(
      `${edge.from}:${edge.line} (${edge.fromLayer}) -> ${edge.to} (${edge.toLayer})`
    );
  }

  const staleDebt = [...debtByEdge.keys()].filter((key) => !usedDebt.has(key));
  ok(duplicateDebt.length === 0, `duplicate dependency debt: ${duplicateDebt.join(', ')}`);
  ok(
    offenders.length === 0,
    `disallowed dependency edge(s); invert/inject the dependency or add one exact reviewed debt entry:\n${offenders.join('\n')}`
  );
  ok(
    staleDebt.length === 0,
    `stale dependency debt must be deleted with the import or policy change:\n${staleDebt.join('\n')}`
  );
});

run('production runtime imports are acyclic', () => {
  const graph = new Map<string, string[]>();
  for (const file of files) graph.set(relativePath(file), []);
  for (const edge of uniqueEdges(edges.filter((item) => item.runtime))) {
    graph.get(edge.from)?.push(edge.to);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const cycles = new Set<string>();
  const visit = (file: string): void => {
    if (visited.has(file)) return;
    if (visiting.has(file)) {
      const start = stack.indexOf(file);
      cycles.add([...stack.slice(start), file].join(' -> '));
      return;
    }
    visiting.add(file);
    stack.push(file);
    for (const dependency of graph.get(file) ?? []) visit(dependency);
    stack.pop();
    visiting.delete(file);
    visited.add(file);
  };
  for (const file of graph.keys()) visit(file);
  ok(cycles.size === 0, `runtime import cycle(s):\n${[...cycles].join('\n')}`);
});

interface DependencyEdge {
  from: string;
  to: string;
  fromLayer: ArchitectureLayer;
  toLayer: ArchitectureLayer;
  line: number;
  runtime: boolean;
}

function collectEdges(source: ts.SourceFile, file: string): void {
  const add = (specifier: string, node: ts.Node, runtime: boolean): void => {
    if (!specifier.startsWith('.')) return;
    if (isStaticAsset(specifier)) return;
    const target = resolveModule(file, specifier);
    if (!target) {
      throw new Error(`${relativePath(file)} imports unresolved local module ${specifier}`);
    }
    const from = relativePath(file);
    const to = relativePath(target);
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    edges.push({
      from,
      to,
      fromLayer: layerOf(from),
      toLayer: layerOf(to),
      line: line + 1,
      runtime
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node.moduleSpecifier.text, node, importDeclarationIsRuntime(node));
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node.moduleSpecifier.text, node, exportDeclarationIsRuntime(node));
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]!)
    ) {
      add(node.arguments[0]!.text, node, true);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      add(node.argument.literal.text, node, false);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

function isStaticAsset(specifier: string): boolean {
  return /\.(?:css|scss|sass|less|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf)$/i.test(specifier);
}

function importDeclarationIsRuntime(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (!clause) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name || !clause.namedBindings || ts.isNamespaceImport(clause.namedBindings)) return true;
  return clause.namedBindings.elements.some((element) => !element.isTypeOnly);
}

function exportDeclarationIsRuntime(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return false;
  if (!node.exportClause || ts.isNamespaceExport(node.exportClause)) return true;
  return node.exportClause.elements.some((element) => !element.isTypeOnly);
}

function resolveModule(importer: string, specifier: string): string | null {
  const base = resolve(dirname(importer), specifier);
  const extensionless = base.replace(/\.(?:[cm]?js|jsx|tsx?)$/i, '');
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.d.ts`,
    `${extensionless}.ts`,
    `${extensionless}.tsx`,
    `${extensionless}.d.ts`,
    join(base, 'index.ts'),
    join(base, 'index.tsx')
  ];
  return candidates.find((candidate) => fileSet.has(candidate)) ?? null;
}

function layerOf(path: string): ArchitectureLayer {
  const first = path.split('/')[0]!;
  if ((ARCHITECTURE_LAYERS as readonly string[]).includes(first) && first !== 'composition') {
    return first as ArchitectureLayer;
  }
  if (path === 'app.ts' || path === 'appShell.ts' || path === 'main.ts' || path === 'global.d.ts') {
    return 'composition';
  }
  throw new Error(`No architecture layer assigned for ${path}`);
}

function uniqueEdges(items: readonly DependencyEdge[]): DependencyEdge[] {
  const found = new Map<string, DependencyEdge>();
  for (const edge of items) {
    const key = `${edgeKey(edge.from, edge.to)}:${edge.runtime ? 'runtime' : 'type'}`;
    if (!found.has(key)) found.set(key, edge);
  }
  return [...found.values()];
}

function edgeKey(from: string, to: string): string {
  return `${from} -> ${to}`;
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
