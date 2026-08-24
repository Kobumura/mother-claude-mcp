// Corpus loading and the source cascade.
//
// Sources are read in declared order and merged into one map keyed by doc ID.
// A later source overwrites an earlier one on the same ID — that single rule is
// the whole customization story: adopt someone's `standards/code-standards`, then
// drop your own file at the same ID to replace it. Shadowed docs are retained on
// the winner as `shadows` so the provenance stays inspectable rather than magic.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname, basename } from 'node:path';
import { parseFrontMatter, stripFrontMatter, extractHeadings } from './frontmatter.js';
import { isSelected } from './glob.js';

const MARKDOWN = new Set(['.md', '.markdown']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.github', '.idea', 'vendor']);
const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})[-_]?(.*)$/;

const toPosix = (p) => p.split('\\').join('/');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || name.startsWith('.')) continue;
    const full = join(dir, name);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue; // a broken symlink should not take down corpus load
    }
    if (stat.isDirectory()) walk(full, out);
    else if (MARKDOWN.has(extname(name).toLowerCase())) out.push(full);
  }
  return out;
}

function docIdFor(sourceDir, absPath) {
  const rel = toPosix(relative(sourceDir, absPath));
  return rel.replace(/\.(md|markdown)$/i, '');
}

// `kind` is derived from the top folder rather than declared in front-matter, so an
// adopter gets sensible grouping from directory layout alone with nothing to author.
function kindFor(id) {
  const parts = id.split('/');
  return parts.length > 1 ? parts[0] : 'general';
}

function titleFor(fields, body, id) {
  if (fields && fields.title) return fields.title;
  const h1 = body.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim();
  const base = basename(id);
  const m = base.match(DATE_PREFIX);
  return (m ? m[2] || m[1] : base).replace(/[-_]/g, ' ');
}

function dateFor(fields, id) {
  if (fields && fields['last-reviewed']) return fields['last-reviewed'];
  if (fields && fields['last-updated']) return fields['last-updated'];
  const m = basename(id).match(DATE_PREFIX);
  return m ? m[1] : null;
}

function readDoc(sourceDir, absPath, source) {
  const raw = readFileSync(absPath, 'utf8');
  const fields = parseFrontMatter(raw);
  const body = stripFrontMatter(raw);
  const id = docIdFor(sourceDir, absPath);

  return {
    id,
    title: titleFor(fields, body, id),
    kind: kindFor(id),
    applies: (fields && fields.applies) || ['all'],
    status: (fields && fields.status) || 'unspecified',
    budget: (fields && fields['context-budget']) || 'reference',
    // Absent `public` is treated as private. Defaulting the other way would leak
    // an un-annotated doc the first time someone enables a public instance.
    public: fields ? fields.public === 'yes' : false,
    date: dateFor(fields, id),
    source: source.name,
    path: absPath,
    hasFrontMatter: Boolean(fields),
    bytes: Buffer.byteLength(raw, 'utf8'),
    body,
    headings: extractHeadings(body),
    shadows: [],
  };
}

export function loadSources(sources) {
  const docs = new Map();
  const warnings = [];

  for (const source of sources) {
    if (!existsSync(source.dir)) {
      if (source.optional) continue;
      warnings.push(`source "${source.name}" is missing at ${source.dir}`);
      continue;
    }

    for (const absPath of walk(source.dir)) {
      const id = docIdFor(source.dir, absPath);
      if (!isSelected(id, source)) continue;

      let doc;
      try {
        doc = readDoc(source.dir, absPath, source);
      } catch (err) {
        warnings.push(`could not read ${absPath}: ${err.message}`);
        continue;
      }

      if (source.publicOnly && !doc.public) continue;

      const previous = docs.get(id);
      if (previous) {
        doc.shadows = [...previous.shadows, { source: previous.source, path: previous.path }];
      }
      docs.set(id, doc);
    }
  }

  return { docs, warnings };
}

export function buildCorpus(config) {
  const rules = loadSources(config.rules);
  const incidents = config.incidents.length
    ? loadSources(config.incidents)
    : { docs: new Map(), warnings: [] };

  let roster = null;
  if (config.roster && existsSync(config.roster)) {
    try {
      roster = JSON.parse(readFileSync(config.roster, 'utf8'));
    } catch (err) {
      rules.warnings.push(`roster at ${config.roster} is not valid JSON: ${err.message}`);
    }
  } else if (config.roster) {
    rules.warnings.push(`roster declared but missing at ${config.roster}`);
  }

  return {
    name: config.name,
    rules: rules.docs,
    incidents: incidents.docs,
    roster,
    profiles: config.profiles,
    warnings: [...rules.warnings, ...incidents.warnings],
    loadedAt: new Date().toISOString(),
  };
}

// Front-matter axes are the only filters the engine understands, because they are
// the only ones it can rely on existing across arbitrary doc sets.
export function filterDocs(docs, { applies, budget, status, kind, id_prefix } = {}) {
  let out = [...docs.values()];
  if (applies) {
    const want = String(applies).toLowerCase();
    out = out.filter((d) => {
      const list = d.applies.map((a) => String(a).toLowerCase());
      return list.includes('all') || list.includes(want);
    });
  }
  if (budget) out = out.filter((d) => d.budget === budget);
  if (status) out = out.filter((d) => d.status === status);
  if (kind) out = out.filter((d) => d.kind === kind);
  if (id_prefix) out = out.filter((d) => d.id.startsWith(id_prefix));
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
