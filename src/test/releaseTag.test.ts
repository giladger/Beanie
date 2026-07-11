import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const releaseScript = resolve(dirname(fileURLToPath(import.meta.url)), '../../scripts/release-tag.mjs');

run('release dry-run reports validation without changing files or invoking npm', () => {
  withFixture(({ root, logPath, env }) => {
    const result = invoke(root, env, ['--dry-run']);

    equal(result.status, 0);
    includes(result.stdout, 'would validate release notes, tests, build, and manifests');
    equal(readVersion(root, 'package.json'), '0.3.0');
    equal(readLog(logPath).some((entry) => entry.command === 'npm'), false);
    equal(readLog(logPath).some(isMutatingGitCommand), false);
  });
});

run('release validation failure restores version files and never creates a release commit or tag', () => {
  withFixture(({ root, logPath, env }) => {
    const result = invoke(root, { ...env, MOCK_NPM_FAILURE: 'run build' }, ['--version=0.3.1']);

    equal(result.status, 1);
    includes(result.stderr, 'Release validation failed; restored version files.');
    equal(readVersion(root, 'package.json'), '0.3.0');
    equal(readVersion(root, 'package-lock.json'), '0.3.0');
    equal(readVersion(root, 'public/manifest.json'), '0.3.0');

    const entries = readLog(logPath);
    deepEqual(
      entries.filter((entry) => entry.command === 'npm').map((entry) => entry.args.join(' ')),
      ['test', 'run test:browser', 'run build']
    );
    equal(entries.some(isMutatingGitCommand), false);
  });
});

run('allow-dirty never releases uncommitted tracked changes', () => {
  withFixture(({ root, logPath, env }) => {
    const result = invoke(root, { ...env, MOCK_GIT_DIRTY: '1' }, ['--allow-dirty', '0.3.1']);

    equal(result.status, 1);
    includes(result.stderr, '--allow-dirty permits untracked files only.');
    equal(readVersion(root, 'package.json'), '0.3.0');
    equal(readLog(logPath).some((entry) => entry.command === 'npm'), false);
    equal(readLog(logPath).some(isMutatingGitCommand), false);
  });
});

run('release refuses a clean non-main branch', () => {
  withFixture(({ root, logPath, env }) => {
    const result = invoke(root, { ...env, MOCK_GIT_BRANCH: 'feature' }, ['--dry-run']);

    equal(result.status, 1);
    includes(result.stderr, 'Releases must be created from main, not feature.');
    equal(readLog(logPath).some(isMutatingGitCommand), false);
  });
});

run('release refuses a main branch behind its remote', () => {
  withFixture(({ root, logPath, env }) => {
    const result = invoke(root, { ...env, MOCK_GIT_BEHIND: '2' }, ['--dry-run']);

    equal(result.status, 1);
    includes(result.stderr, 'Local main is behind or diverged from origin/main.');
    equal(readLog(logPath).some(isMutatingGitCommand), false);
  });
});

run('validated release commits, tags, and atomically pushes the branch and tag', () => {
  withFixture(({ root, logPath, env }) => {
    const result = invoke(root, env, ['0.3.1']);

    equal(result.status, 0);
    equal(readVersion(root, 'package.json'), '0.3.1');
    equal(readVersion(root, 'package-lock.json'), '0.3.1');
    equal(readVersion(root, 'public/manifest.json'), '0.3.1');

    const entries = readLog(logPath);
    deepEqual(
      entries.filter((entry) => entry.command === 'npm').map((entry) => entry.args.join(' ')),
      ['test', 'run test:browser', 'run build', 'run validate:manifest']
    );
    deepEqual(
      entries.filter(isMutatingGitCommand).map((entry) => entry.args),
      [
        ['add', 'package.json', 'package-lock.json', 'public/manifest.json'],
        ['commit', '-m', 'Release v0.3.1'],
        ['tag', '-a', 'v0.3.1', '-m', 'Release v0.3.1'],
        ['push', '--atomic', 'origin', 'HEAD', 'v0.3.1']
      ]
    );
  });
});

interface CommandLog {
  command: 'git' | 'npm';
  args: string[];
}

interface Fixture {
  root: string;
  logPath: string;
  env: NodeJS.ProcessEnv;
}

function withFixture(test: (fixture: Fixture) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'beanie-release-tag-'));
  const bin = join(root, 'bin');
  const logPath = join(root, 'commands.jsonl');
  mkdirSync(bin);
  mkdirSync(join(root, 'public'));

  writeJson(join(root, 'package.json'), { name: 'beanie-test', version: '0.3.0' });
  writeJson(join(root, 'package-lock.json'), {
    name: 'beanie-test',
    version: '0.3.0',
    lockfileVersion: 3,
    packages: { '': { name: 'beanie-test', version: '0.3.0' } }
  });
  writeJson(join(root, 'public/manifest.json'), { id: 'beanie', version: '0.3.0' });
  writeFileSync(join(root, 'CHANGELOG.md'), '# Changelog\n\n## v0.3.1 - 2026-07-11\n\n- Tested release.\n');

  writeExecutable(
    join(bin, 'git'),
    String.raw`#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync(process.env.MOCK_COMMAND_LOG, JSON.stringify({ command: 'git', args }) + '\n');
if (args[0] === 'rev-parse') process.stdout.write('true\n');
if (args[0] === 'status' && process.env.MOCK_GIT_DIRTY) process.stdout.write(' M src/app.ts\n');
if (args[0] === 'tag' && args[1] === '--list' && args[2] === 'v*') process.stdout.write('v0.3.0\n');
if (args[0] === 'branch' && args[1] === '--show-current') process.stdout.write((process.env.MOCK_GIT_BRANCH || 'main') + '\n');
if (args[0] === 'rev-list' && args[1] === '--count') process.stdout.write((process.env.MOCK_GIT_BEHIND || '0') + '\n');
`
  );
  writeExecutable(
    join(bin, 'npm'),
    String.raw`#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync(process.env.MOCK_COMMAND_LOG, JSON.stringify({ command: 'npm', args }) + '\n');
if (args.join(' ') === process.env.MOCK_NPM_FAILURE) process.exit(7);
`
  );

  try {
    test({
      root,
      logPath,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        MOCK_COMMAND_LOG: logPath
      }
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function invoke(root: string, env: NodeJS.ProcessEnv, args: string[]) {
  return spawnSync(process.execPath, [releaseScript, ...args], {
    cwd: root,
    env,
    encoding: 'utf8'
  });
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeExecutable(filePath: string, contents: string): void {
  writeFileSync(filePath, contents);
  chmodSync(filePath, 0o755);
}

function readVersion(root: string, filePath: string): string {
  return JSON.parse(readFileSync(join(root, filePath), 'utf8')).version;
}

function readLog(logPath: string): CommandLog[] {
  try {
    return readFileSync(logPath, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as CommandLog);
  } catch {
    return [];
  }
}

function isMutatingGitCommand(entry: CommandLog): boolean {
  if (entry.command !== 'git') return false;
  if (entry.args[0] === 'tag') return entry.args[1] !== '--list';
  return ['add', 'commit', 'push'].includes(entry.args[0] ?? '');
}

function run(name: string, test: () => void): void {
  try {
    test();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function equal<T>(actual: T, expected: T): void {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
}

function includes(actual: string, expected: string): void {
  if (!actual.includes(expected)) throw new Error(`Expected ${JSON.stringify(actual)} to include ${JSON.stringify(expected)}`);
}

function deepEqual(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}
