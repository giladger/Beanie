import { escapeAttr, escapeHtml } from '../components/html';

run('escapeHtml encodes text for template-string renderers', () => {
  equal(escapeHtml(`A&B <tag attr="x">'`), 'A&amp;B &lt;tag attr=&quot;x&quot;&gt;&#39;');
});

run('escapeAttr mirrors escapeHtml for attribute values', () => {
  const value = `bag "one" & 'two'`;
  equal(escapeAttr(value), escapeHtml(value));
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
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
  }
}
