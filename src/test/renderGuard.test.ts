// The morphing render (src/render/renderer.ts) is the only sanctioned way to
// write markup into the app: a raw `innerHTML =` outside it re-introduces the
// nuke-and-rebuild bug class (lost focus/scroll/canvas state) and, on the
// in-process Android WebView, redundant repaints that leak GPU memory (see
// docs/webview-gpu-oom-investigation.md). An imperative island that truly
// needs one must carry a `// morph-exempt:` comment on an adjacent line
// explaining why, so the exemption is visible in review.

const dynamicImport = (name: string): Promise<unknown> => import(/* @vite-ignore */ name);
const { readdirSync, readFileSync, statSync } = (await dynamicImport('node:fs')) as {
  readdirSync(path: string): string[];
  readFileSync(path: string, encoding: 'utf8'): string;
  statSync(path: string): { isDirectory(): boolean };
};
const { dirname, join, relative } = (await dynamicImport('node:path')) as {
  dirname(path: string): string;
  join(...parts: string[]): string;
  relative(from: string, to: string): string;
};
const { fileURLToPath } = (await dynamicImport('node:url')) as {
  fileURLToPath(url: string | URL): string;
};

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..');

// Files allowed to assign innerHTML without a marker.
const ALLOWED_FILES = new Set(['render/renderer.ts']);

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

const offenders: string[] = [];
for (const file of sourceFiles(srcDir)) {
  const rel = relative(srcDir, file);
  if (ALLOWED_FILES.has(rel)) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (!/\.innerHTML\s*=[^=]/.test(line)) return;
    if (line.trimStart().startsWith('//')) return;
    // Exempt when this line or one of the three above carries the marker.
    const context = lines.slice(Math.max(0, index - 3), index + 1).join('\n');
    if (context.includes('morph-exempt:')) return;
    offenders.push(`${rel}:${index + 1}`);
  });
}

run('no raw innerHTML assignments outside the renderer (morph-exempt to opt out)', () => {
  ok(
    offenders.length === 0,
    `unsanctioned innerHTML assignment(s) — render through morphRender or add a "// morph-exempt: <why>" comment: ${offenders.join(', ')}`
  );
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
