// Turning engine text into Markdown that chat clients show faithfully.

/** The room "screen": a fenced block, so spacing and *asterisks* survive. */
export function roomBlock(text: string): string {
  const body = text.replace(/\s+$/, '');
  const fence = body.includes('```') ? '~~~~' : '```';
  return `${fence}text\n${body}\n${fence}\n\n`;
}

/**
 * Narration as Markdown: escape anything Markdown would act on and keep the
 * engine's line breaks (a backslash at end of line is a CommonMark hard break).
 */
export function narration(text: string): string {
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.replace(/^\n+|\s+$/g, ''))
    .filter((p) => p.length > 0);
  if (!paragraphs.length) return '';
  return (
    paragraphs
      .map((p) => p.split('\n').map(escapeLine).join('\\\n'))
      .join('\n\n') + '\n\n'
  );
}

function escapeLine(line: string): string {
  let s = line.replace(/[\\`*_[\]<>#|~]/g, (c) => `\\${c}`);
  // Leading spaces would be dropped (or start a code block); keep them visible.
  s = s.replace(/^ +/, (sp) => '\u00a0'.repeat(sp.length));
  // Things that start a list or heading at the beginning of a line.
  s = s.replace(/^([-+=])/, '\\$1').replace(/^(\d+)([.)])/, '$1\\$2');
  return s;
}

/** A plain Markdown paragraph from the agent itself (not the game). */
export function note(md: string): string {
  return md.replace(/\s+$/, '') + '\n\n';
}
