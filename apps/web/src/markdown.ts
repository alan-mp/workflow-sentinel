/**
 * The AI drafter answers in light Markdown (bold, inline code, lists). This turns that subset into
 * plain data that React renders as elements, so no HTML from the model ever reaches the page.
 */
export type Inline = { kind: 'text' | 'bold' | 'code'; text: string };
export type Block = { kind: 'p'; lines: Inline[][] } | { kind: 'ul' | 'ol'; items: Inline[][]; start?: number };

export function inline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
    out.push(m[1] !== undefined ? { kind: 'bold', text: m[1] } : { kind: 'code', text: m[2]! });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

export function blocks(source: string): Block[] {
  const out: Block[] = [];
  for (const raw of source.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    const prev = out[out.length - 1];
    if (bullet || numbered) {
      const kind = bullet ? 'ul' : 'ol';
      const item = inline(bullet ? bullet[1]! : numbered![2]!);
      if (prev && prev.kind === kind) prev.items.push(item);
      // A numbered list interrupted by sub-points keeps its original numbering.
      else out.push(kind === 'ol' ? { kind, items: [item], start: Number(numbered![1]) } : { kind, items: [item] });
    } else if (!line.trim()) {
      out.push({ kind: 'p', lines: [] });
    } else if (prev && prev.kind === 'p') {
      prev.lines.push(inline(line.trim()));
    } else {
      out.push({ kind: 'p', lines: [inline(line.trim())] });
    }
  }
  return out.filter((b) => (b.kind === 'p' ? b.lines.length > 0 : true));
}

/** A name for pasted SOP text: its first non-empty line, shortened. */
export function sopTitle(text: string): string {
  const first = text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return first.length > 80 ? `${first.slice(0, 77)}…` : first || 'SOP';
}
