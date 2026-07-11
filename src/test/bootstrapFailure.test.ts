import { bootstrapFailureMarkup } from '../render/bootstrapFailure';

run('bootstrap failure is actionable and escapes technical details', () => {
  const html = bootstrapFailureMarkup(new Error('<script>alert(1)</script>'));
  includes(html, 'Beanie could not start');
  includes(html, 'data-action="bootstrap-reload"');
  includes(html, '&lt;script&gt;alert(1)&lt;/script&gt;');
  excludes(html, '<script>');
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

function includes(text: string, expected: string): void {
  if (!text.includes(expected)) throw new Error(`Expected markup to include ${expected}`);
}

function excludes(text: string, expected: string): void {
  if (text.includes(expected)) throw new Error(`Expected markup not to include ${expected}`);
}
