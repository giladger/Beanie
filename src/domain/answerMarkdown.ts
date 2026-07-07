// Renders Derek's markdown answers to HTML. Deliberately tiny: Derek's
// answers use paragraphs, **bold**, ordered/unordered lists, and `[n]`
// citation markers — that subset is supported and EVERYTHING else is escaped
// text. The answer is remote model output, so nothing it contains may ever
// reach the DOM unescaped.

/** `[n]` markers become tappable citation chips carrying this class. */
export const CITE_MARKER_CLASS = 'derek-cite';

export function renderAnswerMarkdown(text: string, knownCitations?: ReadonlySet<number>): string {
  const blocks = text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  return blocks.map((block) => renderBlock(block, knownCitations)).join('');
}

function renderBlock(block: string, knownCitations?: ReadonlySet<number>): string {
  const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length > 0 && lines.every((line) => /^[-*]\s+/.test(line))) {
    const items = lines
      .map((line) => `<li>${renderInline(line.replace(/^[-*]\s+/, ''), knownCitations)}</li>`)
      .join('');
    return `<ul>${items}</ul>`;
  }
  if (lines.length > 0 && lines.every((line) => /^\d+\.\s+/.test(line))) {
    const items = lines
      .map((line) => `<li>${renderInline(line.replace(/^\d+\.\s+/, ''), knownCitations)}</li>`)
      .join('');
    return `<ol>${items}</ol>`;
  }
  // A markdown heading reads fine as a bold paragraph at this size.
  const headed = lines.map((line) => line.replace(/^#{1,4}\s+(.*)$/, '**$1**'));
  return `<p>${headed.map((line) => renderInline(line, knownCitations)).join('<br />')}</p>`;
}

function renderInline(text: string, knownCitations?: ReadonlySet<number>): string {
  let html = escapeHtml(text);
  // Bold before citations so `**[1]**` still finds its marker.
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\[(\d{1,2})\]/g, (match, digits: string) => {
    const number = Number(digits);
    if (knownCitations && !knownCitations.has(number)) return match;
    return `<sup class="${CITE_MARKER_CLASS}" data-cite="${number}">[${number}]</sup>`;
  });
  return html;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
