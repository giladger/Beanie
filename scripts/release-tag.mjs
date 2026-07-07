#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const allowDirty = args.has('--allow-dirty');
const remote = optionValue('--remote') ?? 'origin';
const tagPattern = /^v(\d+)\.(\d+)\.(\d+)$/;

main();

function main() {
  assertGitRepo();
  if (!dryRun && !allowDirty) assertCleanWorktree();
  fetchTags(remote);

  const tags = semverTags();
  const latest = tags.at(-1) ?? null;

  const requested = requestedVersion();
  let next;
  if (requested) {
    // Explicit version wins over the default patch bump — use it for minor/major
    // releases (e.g. `npm run release -- 0.3.0`).
    next = `v${requested.major}.${requested.minor}.${requested.patch}`;
    if (latest && !isGreater(requested, latest)) {
      fail(`${next} is not greater than the latest tag ${latest.tag}.`);
    }
  } else {
    if (!latest) {
      fail('No existing vX.Y.Z tags found. Pass an explicit version, e.g. --version=0.1.0.');
    }
    next = `v${latest.major}.${latest.minor}.${latest.patch + 1}`;
  }
  assertTagMissing(next, remote);

  if (dryRun) {
    console.log(`ok - would bump project version to ${next.slice(1)}`);
    console.log(`ok - would commit, tag, and push ${next}${latest ? ` from ${latest.tag}` : ''}`);
    return;
  }

  const nextVersion = next.slice(1);
  updateProjectVersion(nextVersion);
  git(['add', 'package.json', 'package-lock.json', 'public/manifest.json']);
  git(['commit', '-m', `Release ${next}`]);
  git(['tag', '-a', next, '-m', `Release ${next}`]);
  git(['push', remote, 'HEAD']);
  git(['push', remote, next]);
  console.log(`ok - bumped project version, committed, tagged, and pushed ${next}`);
}

function optionValue(name) {
  const prefix = `${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return null;
}

// An explicit target version from `--version=X.Y.Z` or a bare positional `X.Y.Z`
// (a leading `v` is accepted). Returns null when none is given.
function requestedVersion() {
  const raw = optionValue('--version') ?? positionalArg();
  if (!raw) return null;
  const match = raw.replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) fail(`Invalid version "${raw}". Expected X.Y.Z (e.g. 0.3.0).`);
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function positionalArg() {
  for (const arg of process.argv.slice(2)) {
    if (!arg.startsWith('-')) return arg;
  }
  return null;
}

function isGreater(a, b) {
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  return a.patch > b.patch;
}

function assertGitRepo() {
  const inside = git(['rev-parse', '--is-inside-work-tree'], { silent: true }).trim();
  if (inside !== 'true') fail('Run this from inside the Beanie git worktree.');
}

function assertCleanWorktree() {
  const status = git(['status', '--porcelain'], { silent: true });
  if (status.trim() !== '') {
    fail('Working tree is dirty. Commit or stash changes before creating a release tag.');
  }
}

function fetchTags(remoteName) {
  git(['fetch', remoteName, '--tags']);
}

function semverTags() {
  return git(['tag', '--list', 'v*'], { silent: true })
    .split('\n')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => {
      const match = tag.match(tagPattern);
      if (!match) return null;
      return {
        tag,
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3])
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.major - b.major || a.minor - b.minor || a.patch - b.patch);
}

function assertTagMissing(tag, remoteName) {
  const localTags = new Set(
    git(['tag', '--list', tag], { silent: true })
      .split('\n')
      .map((value) => value.trim())
      .filter(Boolean)
  );
  if (localTags.has(tag)) fail(`${tag} already exists locally.`);

  const remoteTag = git(['ls-remote', '--tags', remoteName, tag], { silent: true }).trim();
  if (remoteTag !== '') fail(`${tag} already exists on ${remoteName}.`);
}

function updateProjectVersion(version) {
  updateJsonFile('package.json', (json) => {
    json.version = version;
  });
  updateJsonFile('package-lock.json', (json) => {
    json.version = version;
    if (json.packages?.['']) json.packages[''].version = version;
  });
  updateJsonFile('public/manifest.json', (json) => {
    json.version = version;
  });
}

function updateJsonFile(filePath, mutate) {
  const json = JSON.parse(readFileSync(filePath, 'utf8'));
  mutate(json);
  writeFileSync(filePath, `${JSON.stringify(json, null, 2)}\n`);
}

function git(args, options = {}) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: options.silent ? ['ignore', 'pipe', 'pipe'] : 'inherit'
    });
  } catch (error) {
    const message = error.stderr?.toString().trim() || error.message;
    fail(`git ${args.join(' ')} failed: ${message}`);
  }
}

function fail(message) {
  console.error(`not ok - ${message}`);
  process.exit(1);
}
