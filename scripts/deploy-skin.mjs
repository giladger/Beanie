#!/usr/bin/env node
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { resolveSkinDir } from './skin-paths.mjs';

const root = process.cwd();
const distDir = path.join(root, 'dist');
const skinDir = resolveSkinDir();

await rm(skinDir, { recursive: true, force: true });
await mkdir(skinDir, { recursive: true });
await cp(distDir, skinDir, { recursive: true });

console.log(`ok - deployed Beanie build to ${skinDir}`);
