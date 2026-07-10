import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';

// Architecture enforcement, not a style preference: app.ts and controllers
// ingest events and publish models. Presentation mutations belong to explicit
// owners under src/render, where write gates and lifecycle cleanup are tested.

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const guardedFiles = [join(srcDir, 'app.ts'), ...typescriptFiles(join(srcDir, 'controllers'))];
const directPresentationProperties = new Set([
  'innerHTML',
  'outerHTML',
  'textContent',
  'className',
  'src'
]);
const mutatingMethods = new Set([
  'appendChild',
  'insertAdjacentElement',
  'insertAdjacentHTML',
  'insertAdjacentText',
  'removeAttribute',
  'replaceChildren',
  'replaceWith',
  'setAttribute',
  'toggleAttribute'
]);
const mutatingClassListMethods = new Set(['add', 'remove', 'replace', 'toggle']);
const offenders: string[] = [];

for (const file of guardedFiles) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  visit(source, source, file);
}

run('app orchestration and controllers contain no presentation DOM mutations', () => {
  ok(
    offenders.length === 0,
    `move presentation mutation(s) behind a src/render owner: ${offenders.join(', ')}`
  );
});

function visit(node: ts.Node, source: ts.SourceFile, file: string): void {
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isPropertyAccessExpression(node.left) &&
    isPresentationAssignment(node.left)
  ) {
    addOffender(node.left, source, file);
  }

  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const call = node.expression;
    const method = call.name.text;
    const receiver = call.expression;
    const mutatesClassList =
      mutatingClassListMethods.has(method) &&
      ts.isPropertyAccessExpression(receiver) &&
      receiver.name.text === 'classList';
    if (mutatingMethods.has(method) || mutatesClassList) {
      addOffender(call, source, file);
    }
  }
  ts.forEachChild(node, (child) => visit(child, source, file));
}

function isPresentationAssignment(target: ts.PropertyAccessExpression): boolean {
  if (directPresentationProperties.has(target.name.text)) return true;
  if (!ts.isPropertyAccessExpression(target.expression)) return false;
  return target.expression.name.text === 'style' || target.expression.name.text === 'dataset';
}

function addOffender(node: ts.Node, source: ts.SourceFile, file: string): void {
  const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
  offenders.push(`${relative(srcDir, file)}:${line + 1}`);
}

function typescriptFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...typescriptFiles(full));
    else if (entry.endsWith('.ts')) files.push(full);
  }
  return files;
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
