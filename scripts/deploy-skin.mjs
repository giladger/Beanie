#!/usr/bin/env node
import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveSkinDir } from './skin-paths.mjs';

const root = process.cwd();
const distDir = path.join(root, 'dist');
const skinDir = resolveSkinDir();
const manifest = JSON.parse(await readFile(path.join(root, 'public', 'manifest.json'), 'utf8'));

assertSafeDeployTarget(skinDir, root, manifest.id);
await rm(skinDir, { recursive: true, force: true });
await mkdir(skinDir, { recursive: true });
await cp(distDir, skinDir, { recursive: true });

console.log(`ok - deployed Beanie build to ${skinDir}`);

function assertSafeDeployTarget(targetDir, repoRoot, skinId) {
  const target = path.resolve(targetDir);
  const rootDir = path.parse(target).root;
  const homeDir = path.resolve(os.homedir());
  const resolvedRepoRoot = path.resolve(repoRoot);

  if (typeof skinId !== 'string' || skinId.trim() === '') {
    fail('public/manifest.json is missing a skin id.');
  }
  if (path.basename(target) !== skinId) {
    fail(`Refusing to deploy to ${target}; target folder must be named "${skinId}".`);
  }
  if (target === rootDir) {
    fail(`Refusing to deploy to filesystem root ${target}.`);
  }
  if (target === homeDir || isAncestorOf(target, homeDir)) {
    fail(`Refusing to deploy to ${target}; it contains the home directory.`);
  }
  if (target === resolvedRepoRoot || isAncestorOf(target, resolvedRepoRoot)) {
    fail(`Refusing to deploy to ${target}; it contains the Beanie repository.`);
  }
}

function isAncestorOf(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function fail(message) {
  console.error(`not ok - ${message}`);
  process.exit(1);
}
