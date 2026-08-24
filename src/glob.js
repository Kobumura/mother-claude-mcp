// Minimal glob matcher for doc IDs (forward-slash paths, no extension).
// Supports `*` (within a segment), `**` (across segments) and `?`. A bare pattern
// with no wildcard matches a doc ID exactly OR as a directory prefix, so
// `include: ["standards"]` pulls in the whole standards folder without ceremony.

const REGEX_SPECIAL = new Set('.+^${}()|[]\\'.split(''));

function toRegExp(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        out += '.*';
        i++;
        if (pattern[i + 1] === '/') i++; // `**/` also matches zero segments
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else {
      out += REGEX_SPECIAL.has(ch) ? `\\${ch}` : ch;
    }
  }
  return new RegExp(`^${out}$`);
}

export function matchesPattern(id, pattern) {
  if (!/[*?]/.test(pattern)) {
    const clean = pattern.replace(/\/+$/, '');
    return id === clean || id.startsWith(`${clean}/`);
  }
  return toRegExp(pattern).test(id);
}

export function matchesAny(id, patterns) {
  return patterns.some((p) => matchesPattern(id, p));
}

// `include` acts as an allow-list only when non-empty; `exclude` always wins.
export function isSelected(id, { include = [], exclude = [] } = {}) {
  if (exclude.length && matchesAny(id, exclude)) return false;
  if (include.length && !matchesAny(id, include)) return false;
  return true;
}
