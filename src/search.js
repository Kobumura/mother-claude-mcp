// Ranked full-text search over a loaded corpus.
//
// Deliberately dependency-free lexical scoring rather than embeddings: the corpus is
// a few hundred documents of controlled vocabulary, an index rebuild has to be
// instant, and a served brain that needs a model to answer "where is the migration
// rule" has the failure mode of being unavailable exactly when the network is.

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'is', 'it', 'for', 'on', 'we',
  'do', 'does', 'how', 'what', 'when', 'why', 'with', 'this', 'that', 'be', 'are',
]);

const WEIGHT = { title: 12, heading: 4, body: 1, exact_phrase: 20, id: 8 };
const EXCERPT_RADIUS = 160;

export function tokenize(text) {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9_+-]+/)
    .map((t) => t.replace(/^[-+]+|[-+]+$/g, ''))
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function buildExcerpt(body, terms, phrase) {
  const lower = body.toLowerCase();
  let at = phrase ? lower.indexOf(phrase) : -1;
  if (at === -1) {
    for (const term of terms) {
      at = lower.indexOf(term);
      if (at !== -1) break;
    }
  }
  if (at === -1) return body.slice(0, EXCERPT_RADIUS).trim();

  const start = Math.max(0, at - EXCERPT_RADIUS / 2);
  const end = Math.min(body.length, at + EXCERPT_RADIUS);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < body.length ? '…' : '';
  return `${prefix}${body.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;
}

function nearestHeading(doc, body, excerptAnchor) {
  if (!doc.headings.length || excerptAnchor < 0) return null;
  const lineOfAnchor = body.slice(0, excerptAnchor).split('\n').length;
  let best = null;
  for (const heading of doc.headings) {
    if (heading.line <= lineOfAnchor) best = heading;
    else break;
  }
  return best ? best.text : null;
}

export function scoreDoc(doc, terms, phrase) {
  const titleLower = doc.title.toLowerCase();
  const idLower = doc.id.toLowerCase();
  const bodyLower = doc.body.toLowerCase();
  const headingsLower = doc.headings.map((h) => h.text.toLowerCase()).join('\n');

  let score = 0;
  if (phrase && phrase.length > 2) {
    score += countOccurrences(bodyLower, phrase) * WEIGHT.exact_phrase;
    if (titleLower.includes(phrase)) score += WEIGHT.exact_phrase;
  }

  for (const term of terms) {
    if (titleLower.includes(term)) score += WEIGHT.title;
    if (idLower.includes(term)) score += WEIGHT.id;
    score += countOccurrences(headingsLower, term) * WEIGHT.heading;
    // Body hits saturate: one doc mentioning a term 80 times should not outrank a
    // doc whose title is the term.
    score += Math.min(countOccurrences(bodyLower, term), 8) * WEIGHT.body;
  }

  // A doc matching every term beats one matching a single term many times.
  const matched = terms.filter(
    (t) => titleLower.includes(t) || bodyLower.includes(t) || idLower.includes(t)
  ).length;
  if (terms.length > 1 && matched === terms.length) score *= 1.5;

  return { score, matched };
}

export function search(docs, query, { limit = 8, filter = null } = {}) {
  const phrase = String(query).toLowerCase().trim();
  const terms = tokenize(query);
  if (!terms.length && !phrase) return [];

  const pool = filter ? [...docs.values()].filter(filter) : [...docs.values()];
  const hits = [];

  for (const doc of pool) {
    const { score, matched } = scoreDoc(doc, terms, phrase);
    if (score <= 0) continue;
    const lower = doc.body.toLowerCase();
    const anchor = phrase && lower.includes(phrase)
      ? lower.indexOf(phrase)
      : terms.map((t) => lower.indexOf(t)).find((i) => i !== -1) ?? -1;

    hits.push({
      id: doc.id,
      title: doc.title,
      kind: doc.kind,
      source: doc.source,
      status: doc.status,
      score: Math.round(score * 10) / 10,
      matched_terms: matched,
      section: nearestHeading(doc, doc.body, anchor),
      excerpt: buildExcerpt(doc.body, terms, phrase),
    });
  }

  return hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
}
