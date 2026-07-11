import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'styles.css'), 'utf8');

run('shared styles retain a visible keyboard focus treatment', () => {
  equal(css.includes(':where(button, input, select, textarea, [role="button"], [tabindex]):focus-visible'), true);
  equal(css.includes('.settings-toggle input:focus-visible + span'), true);
  equal(css.includes('outline: 3px solid var(--accent) !important'), true);
});

run('shared styles honor the reduced-motion preference', () => {
  const start = css.indexOf('@media (prefers-reduced-motion: reduce)');
  equal(start >= 0, true);
  const block = css.slice(start);
  equal(block.includes('animation-duration: 0.01ms !important'), true);
  equal(block.includes('animation-iteration-count: 1 !important'), true);
  equal(block.includes('transition-duration: 0.01ms !important'), true);
  equal(block.includes('scroll-behavior: auto !important'), true);
});

run('read-only toggles have a visible disabled treatment', () => {
  equal(css.includes('.settings-toggle input:disabled + span'), true);
  equal(css.includes('cursor: not-allowed'), true);
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

function equal<T>(actual: T, expected: T): void {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
}
