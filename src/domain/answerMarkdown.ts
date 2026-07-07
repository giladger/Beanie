// Renders Derek's markdown answers to HTML. Deliberately tiny: Derek's
// answers use paragraphs, **bold**, and ordered/unordered lists — that subset
// is supported and EVERYTHING else is escaped text. The answer is remote
// model output, so nothing it contains may ever reach the DOM unescaped.
//
// Derek cites its RAG sources as `[n]` markers; Beanie doesn't surface the
// source list, so the markers are stripped rather than rendered as chips
// pointing nowhere.

/** Remove `[n]` citation markers (and the space before them) from answer text. */
export function stripCitationMarkers(text: string): string {
  // Loop until stable: in "profile [2][5]." the first pass can only strip the
  // trailing marker (the lookahead keeps word-adjacent brackets like
  // "array[1]indexing" intact), which re-exposes the one before it.
  let out = text;
  for (;;) {
    const next = out.replace(/\s*\[\d{1,2}\](?=[\s.,;:!?)"'\]]|\[|$)/g, '');
    if (next === out) return next;
    out = next;
  }
}

export function renderAnswerMarkdown(text: string): string {
  const blocks = stripCitationMarkers(text)
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  return blocks.map((block) => renderBlock(block)).join('');
}

function renderBlock(block: string): string {
  const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length > 0 && lines.every((line) => /^[-*]\s+/.test(line))) {
    const items = lines
      .map((line) => `<li>${renderInline(line.replace(/^[-*]\s+/, ''))}</li>`)
      .join('');
    return `<ul>${items}</ul>`;
  }
  if (lines.length > 0 && lines.every((line) => /^\d+\.\s+/.test(line))) {
    const items = lines
      .map((line) => `<li>${renderInline(line.replace(/^\d+\.\s+/, ''))}</li>`)
      .join('');
    return `<ol>${items}</ol>`;
  }
  // A markdown heading reads fine as a bold paragraph at this size.
  const headed = lines.map((line) => line.replace(/^#{1,4}\s+(.*)$/, '**$1**'));
  return `<p>${headed.map((line) => renderInline(line)).join('<br />')}</p>`;
}

function renderInline(text: string): string {
  return escapeHtml(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
