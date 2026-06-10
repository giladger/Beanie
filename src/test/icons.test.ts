import * as lucide from 'lucide';
import { registeredIconNames } from '../components/icons';

// `icon('x')` only renders when the matching lucide component is registered in
// icons.ts — an unregistered name leaves an empty <i> placeholder. This test
// greps the src/ tree for icon-name literals and pins that each is registered.

// The project tsconfig is browser-lib only (no @types/node), so reach node's
// fs/path/url through dynamic imports typed by these minimal local interfaces.
const dynamicImport = (name: string): Promise<unknown> => import(/* @vite-ignore */ name);
const { readdirSync, readFileSync, statSync } = (await dynamicImport('node:fs')) as {
  readdirSync(path: string): string[];
  readFileSync(path: string, encoding: 'utf8'): string;
  statSync(path: string): { isDirectory(): boolean };
};
const { dirname, join } = (await dynamicImport('node:path')) as {
  dirname(path: string): string;
  join(...parts: string[]): string;
};
const { fileURLToPath } = (await dynamicImport('node:url')) as {
  fileURLToPath(url: string | URL): string;
};

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..');

// Mirrors lucide's toPascalCase, which createIcons uses to match data-lucide
// names against registered components ('log-in' -> 'LogIn', 'trash-2' -> 'Trash2').
function toPascalCase(name: string): string {
  return name.replace(/(\w)(\w*)(_|-|\s*)/g, (_m, first: string, rest: string) => first.toUpperCase() + rest.toLowerCase());
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (full === join(srcDir, 'test')) continue;
      out.push(...sourceFiles(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

const usedNames = new Set<string>();
for (const file of sourceFiles(srcDir)) {
  const text = readFileSync(file, 'utf8');
  // Direct calls — every literal inside icon(...), covering inline ternaries
  // like icon(editing ? 'check' : 'plus').
  for (const call of text.matchAll(/\bicon\(([^)]*)\)/g)) {
    for (const literal of call[1]!.matchAll(/'([a-z0-9-]+)'/g)) usedNames.add(literal[1]!);
  }
  // Known indirections — icon names stored on an `icon:` property or an
  // `...icon... =` binding before flowing into icon(name), including ternaries
  // continued on `?`/`:` lines. Other strings can share these statements
  // (e.g. type === 'pressure'), so only literals that are real lucide exports
  // count as icon names here.
  for (const stmt of text.matchAll(/\b\w*[iI]con\w*\s*[:=][^;,\n]*(?:\n\s*[?:][^;,\n]*)*/g)) {
    for (const literal of stmt[0].matchAll(/'([a-z0-9-]+)'/g)) {
      if (toPascalCase(literal[1]!) in lucide) usedNames.add(literal[1]!);
    }
  }
}

run('the source grep finds known icon usages (guards the extraction itself)', () => {
  for (const expected of ['plus', 'save', 'log-in', 'log-out', 'coffee', 'arrow-up-to-line']) {
    ok(usedNames.has(expected), `expected the src/ grep to find icon name '${expected}'`);
  }
});

run('every icon name used in src/ is registered in icons.ts', () => {
  const missing = [...usedNames]
    .filter((name) => !registeredIconNames.has(toPascalCase(name)))
    .sort();
  ok(missing.length === 0, `unregistered icon name(s) would render empty: ${missing.join(', ')}`);
});

run('save / log-in / log-out are registered (regression)', () => {
  for (const name of ['Save', 'LogIn', 'LogOut']) {
    ok(registeredIconNames.has(name), `expected ${name} to be registered`);
  }
});

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
