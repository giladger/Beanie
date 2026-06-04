#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

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
  if (tags.length === 0) {
    fail('No existing vX.Y.Z tags found.');
  }

  const latest = tags.at(-1);
  const next = `v${latest.major}.${latest.minor}.${latest.patch + 1}`;
  assertTagMissing(next, remote);

  if (dryRun) {
    console.log(`ok - would create and push ${next} from ${latest.tag}`);
    return;
  }

  git(['tag', '-a', next, '-m', `Release ${next}`]);
  git(['push', remote, next]);
  console.log(`ok - created and pushed ${next}`);
}

function optionValue(name) {
  const prefix = `${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return null;
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
