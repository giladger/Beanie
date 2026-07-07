import { renderAnswerMarkdown } from '../domain/answerMarkdown';

run('renders paragraphs, bold, and lists', () => {
  const html = renderAnswerMarkdown(
    'This shot is **underextracted**.\n\n1. Grind finer.\n2. Raise the temperature.\n\n- keep the dose\n- keep the ratio'
  );
  equal(
    html,
    '<p>This shot is <strong>underextracted</strong>.</p>' +
      '<ol><li>Grind finer.</li><li>Raise the temperature.</li></ol>' +
      '<ul><li>keep the dose</li><li>keep the ratio</li></ul>'
  );
});

run('renders citation markers as chips, filtered by the known set', () => {
  const html = renderAnswerMarkdown('Grind finer. [1] Maybe hotter. [9]', new Set([1]));
  contains(html, '<sup class="derek-cite" data-cite="1">[1]</sup>');
  contains(html, 'Maybe hotter. [9]');
  if (html.includes('data-cite="9"')) throw new Error('unknown citation must stay plain text');
});

run('escapes every HTML construct in model output', () => {
  const html = renderAnswerMarkdown(
    '<script>alert(1)</script> **<img src=x onerror=alert(1)>** [1] <a href="javascript:evil()">link</a>'
  );
  if (/<(script|img|a)\b/.test(html)) throw new Error(`unescaped HTML leaked: ${html}`);
  contains(html, '&lt;script&gt;');
  contains(html, '<strong>&lt;img src=x onerror=alert(1)&gt;</strong>');
});

run('treats headings as bold paragraphs and joins single newlines', () => {
  const html = renderAnswerMarkdown('### What to try\nGrind finer.');
  equal(html, '<p><strong>What to try</strong><br />Grind finer.</p>');
});

function contains(haystack: string, needle: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(`Expected to find "${needle}" in:\n${haystack}`);
  }
}

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
    throw new Error(`Expected:\n${String(expected)}\nReceived:\n${String(actual)}`);
  }
}
