import { renderAnswerMarkdown, stripCitationMarkers } from '../domain/answerMarkdown';

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

run('strips citation markers instead of rendering them', () => {
  equal(stripCitationMarkers('Grind finer. [1] Hotter helps [2], too [13].'), 'Grind finer. Hotter helps, too.');
  // Consecutive markers all strip (the live-answer regression).
  equal(stripCitationMarkers('typical for the Default profile [2][5]. However'), 'typical for the Default profile. However');
  equal(stripCitationMarkers('stacked [1][2][3] markers'), 'stacked markers');
  // Bracketed numbers that are not citations (mid-word/data) survive.
  equal(stripCitationMarkers('array[1]indexing'), 'array[1]indexing');
  const html = renderAnswerMarkdown('Grind **finer**. [1]');
  equal(html, '<p>Grind <strong>finer</strong>.</p>');
});

run('escapes every HTML construct in model output', () => {
  const html = renderAnswerMarkdown(
    '<script>alert(1)</script> **<img src=x onerror=alert(1)>** <a href="javascript:evil()">link</a>'
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
