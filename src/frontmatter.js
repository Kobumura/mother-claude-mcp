// YAML-subset front-matter parser. Deliberately not a full YAML implementation:
// docs carry flat scalars and inline arrays, and a real YAML dep is not worth the
// supply-chain surface for that. Tolerates CRLF (Windows autocrlf checkouts) and
// trailing `# comment` on a value.

const STRIP_COMMENT = /\s+#.*$/;

// Strip surrounding quotes only when they are a matched pair. Stripping either end
// independently corrupts a title that legitimately ends in a quoted phrase — e.g.
// `open-ended "what could this become"` lost its closing quote.
function unquote(value) {
  const first = value[0];
  if ((first === '"' || first === "'") && value.length > 1 && value.endsWith(first)) {
    return value.slice(1, -1);
  }
  return value;
}

export function parseFrontMatter(text) {
  if (!text.startsWith('---')) return null;
  const norm = text.replace(/\r\n/g, '\n');
  const end = norm.indexOf('\n---', 3);
  if (end === -1) return null;

  const fields = {};
  for (const line of norm.slice(3, end).split('\n')) {
    const m = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      fields[key] = value
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      continue;
    }
    // A `#` only starts a comment when it follows whitespace, so `budget: #1` stays intact.
    value = value.replace(STRIP_COMMENT, '').trim();
    fields[key] = unquote(value);
  }
  return fields;
}

export function stripFrontMatter(text) {
  if (!text.startsWith('---')) return text;
  const norm = text.replace(/\r\n/g, '\n');
  const end = norm.indexOf('\n---', 3);
  return end === -1 ? norm : norm.slice(end + 4).replace(/^\s+/, '');
}

// Markdown ATX headings, used for search ranking and for the section outline
// returned by get_doc. Fenced code blocks are skipped so a `# comment` inside a
// shell example never becomes a heading.
export function extractHeadings(body) {
  const headings = [];
  let inFence = false;
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = line.match(/^(#{1,6})\s+(.*)$/);
    if (m) headings.push({ level: m[1].length, text: m[2].trim(), line: i + 1 });
  }
  return headings;
}
