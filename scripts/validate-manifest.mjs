#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const packageJson = readJson(path.join(root, 'package.json'));
const manifestPaths = [
  path.join(root, 'public', 'manifest.json'),
  path.join(root, 'dist', 'manifest.json')
].filter((filePath) => existsSync(filePath));

if (manifestPaths.length === 0) {
  fail('No manifest found at public/manifest.json or dist/manifest.json.');
}

for (const manifestPath of manifestPaths) {
  validateManifest(manifestPath, readJson(manifestPath), packageJson);
}

console.log(`ok - validated ${manifestPaths.length} skin manifest${manifestPaths.length === 1 ? '' : 's'}`);

function validateManifest(manifestPath, manifest, pkg) {
  const label = path.relative(root, manifestPath);
  const required = ['id', 'name', 'description', 'version', 'author'];

  for (const field of required) {
    const value = manifest[field];
    if (typeof value !== 'string' || value.trim() === '') {
      fail(`${label} is missing a non-empty "${field}" field.`);
    }
  }

  if (!/^[a-z0-9][a-z0-9_-]*$/.test(manifest.id)) {
    fail(`${label} has invalid id "${manifest.id}". Use lowercase letters, digits, hyphen, or underscore.`);
  }

  if (manifest.version !== pkg.version) {
    fail(`${label} version ${manifest.version} does not match package.json version ${pkg.version}.`);
  }

  if (manifest.repository != null) {
    try {
      new URL(manifest.repository);
    } catch {
      fail(`${label} repository must be a valid URL when present.`);
    }
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(`Could not read ${path.relative(root, filePath)}: ${error.message}`);
  }
}

function fail(message) {
  console.error(`not ok - ${message}`);
  process.exit(1);
}
