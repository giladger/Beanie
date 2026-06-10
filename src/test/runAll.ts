import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = dirname(fileURLToPath(import.meta.url));
const testFiles = readdirSync(testDir)
  .filter((file) => file.endsWith('.test.ts'))
  .sort();

for (const file of testFiles) {
  await import(join(testDir, file));
}
