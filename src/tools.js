// MCP tool surface.
//
// Every tool returns compact JSON rather than prose. The point of serving the brain
// is to stop paying for a 500KB corpus on every session; a tool that answers with
// three pages of markdown when the caller wanted a filename defeats that, so the
// index tools return metadata and callers opt in to bodies.

import { z } from 'zod';
import { filterDocs } from './corpus.js';
import { search } from './search.js';

// Bodies are capped so one enormous doc cannot blow a caller's context window.
// The cap is announced in the payload rather than silently applied.
const MAX_BODY_BYTES = 48_000;

const json = (payload) => ({
  content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
});

const fail = (message, extra = {}) => ({
  isError: true,
  content: [{ type: 'text', text: JSON.stringify({ error: message, ...extra }, null, 2) }],
});

function summarize(doc) {
  return {
    id: doc.id,
    title: doc.title,
    kind: doc.kind,
    applies: doc.applies,
    status: doc.status,
    budget: doc.budget,
    source: doc.source,
    last_reviewed: doc.date,
    bytes: doc.bytes,
    sections: doc.headings.filter((h) => h.level <= 2).map((h) => h.text).slice(0, 12),
  };
}

function bodyOf(doc) {
  if (doc.bytes <= MAX_BODY_BYTES) return { body: doc.body, truncated: false };
  return {
    body: doc.body.slice(0, MAX_BODY_BYTES),
    truncated: true,
    truncation_note:
      `Body truncated at ${MAX_BODY_BYTES} bytes of ${doc.bytes}. ` +
      `Call get_doc with a "section" argument to read a specific part in full.`,
  };
}

// Pull one `## Section` out of a doc so a caller can read the migration rule without
// paying for the whole standards file.
function sliceSection(doc, wanted) {
  const target = String(wanted).toLowerCase().trim();
  const lines = doc.body.split('\n');
  const match = doc.headings.find(
    (h) => h.text.toLowerCase() === target || h.text.toLowerCase().includes(target)
  );
  if (!match) return null;

  const start = match.line - 1;
  let end = lines.length;
  for (const h of doc.headings) {
    if (h.line - 1 > start && h.level <= match.level) {
      end = h.line - 1;
      break;
    }
  }
  return { heading: match.text, text: lines.slice(start, end).join('\n').trim() };
}

export function registerTools(server, getCorpus) {
  server.registerTool(
    'get_rules',
    {
      title: 'Get the rules that apply right now',
      description:
        'Return the slice of the engineering constitution that applies to a given kind of work. ' +
        'Start here at session boot. Returns an index by default; set include_body to read them. ' +
        'Prefer a profile when one fits — profiles are the operator-defined presets for common roles.',
      inputSchema: {
        profile: z.string().optional()
          .describe('A named preset from the operator config (see list_profiles).'),
        applies: z.string().optional()
          .describe('Audience tier, e.g. mobile | api | web | php. Docs marked "all" always match.'),
        budget: z.enum(['lean', 'reference']).optional()
          .describe('lean = the short always-on gates; reference = the full detail docs.'),
        kind: z.string().optional().describe('Top-level folder, e.g. standards | playbooks | process.'),
        include_body: z.boolean().optional().describe('Include full document bodies. Default false.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      const corpus = getCorpus();
      let query = { ...args };

      if (args.profile) {
        const preset = corpus.profiles[args.profile];
        if (!preset) {
          return fail(`unknown profile "${args.profile}"`, {
            available: Object.keys(corpus.profiles),
          });
        }
        // Explicit arguments beat the preset, so a profile is a default and not a cage.
        query = { ...preset, ...args };
      }

      const docs = filterDocs(corpus.rules, query);
      return json({
        corpus: corpus.name,
        profile: args.profile ?? null,
        filters: {
          applies: query.applies ?? null,
          budget: query.budget ?? null,
          kind: query.kind ?? null,
        },
        count: docs.length,
        docs: docs.map((doc) =>
          args.include_body ? { ...summarize(doc), ...bodyOf(doc) } : summarize(doc)
        ),
      });
    }
  );

  server.registerTool(
    'get_doc',
    {
      title: 'Read one document',
      description:
        'Read a document by ID (as returned by get_rules, search_docs or list_docs). ' +
        'Pass a section to read just one part of a long document.',
      inputSchema: {
        id: z.string().describe('Document ID, e.g. "standards/code-standards".'),
        section: z.string().optional().describe('Heading text, or part of it, to return alone.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ id, section }) => {
      const corpus = getCorpus();
      const doc = corpus.rules.get(id) || corpus.incidents.get(id);
      if (!doc) {
        const near = search(corpus.rules, id.split('/').pop() || id, { limit: 4 });
        return fail(`no document with id "${id}"`, { did_you_mean: near.map((h) => h.id) });
      }

      if (section) {
        const found = sliceSection(doc, section);
        if (!found) {
          return fail(`no section matching "${section}" in "${id}"`, {
            available_sections: doc.headings.map((h) => h.text),
          });
        }
        return json({ ...summarize(doc), section: found.heading, body: found.text });
      }

      return json({ ...summarize(doc), shadows: doc.shadows, ...bodyOf(doc) });
    }
  );

  server.registerTool(
    'search_docs',
    {
      title: 'Search the corpus',
      description:
        'Ranked search across the rules corpus, the incident history, or both. ' +
        'Use this when you know what you need but not which document holds it.',
      inputSchema: {
        query: z.string().describe('Natural-language or keyword query.'),
        corpus: z.enum(['rules', 'incidents', 'both']).optional().describe('Default "rules".'),
        limit: z.number().int().min(1).max(25).optional().describe('Default 8.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, corpus: which = 'rules', limit = 8 }) => {
      const corpus = getCorpus();
      const results = {};
      if (which === 'rules' || which === 'both') {
        results.rules = search(corpus.rules, query, { limit });
      }
      if (which === 'incidents' || which === 'both') {
        results.incidents = search(corpus.incidents, query, { limit });
      }
      return json({ query, ...results });
    }
  );

  server.registerTool(
    'list_docs',
    {
      title: 'List the corpus index',
      description: 'The full document index with no bodies. Useful for orientation.',
      inputSchema: {
        kind: z.string().optional(),
        applies: z.string().optional(),
        status: z.string().optional(),
        corpus: z.enum(['rules', 'incidents']).optional().describe('Default "rules".'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ corpus: which = 'rules', ...filters }) => {
      const corpus = getCorpus();
      const docs = filterDocs(which === 'incidents' ? corpus.incidents : corpus.rules, filters);
      return json({
        corpus: corpus.name,
        which,
        count: docs.length,
        docs: docs.map((d) => ({
          id: d.id, title: d.title, kind: d.kind, applies: d.applies,
          status: d.status, budget: d.budget, bytes: d.bytes,
        })),
      });
    }
  );

  server.registerTool(
    'lookup_incident',
    {
      title: 'Has this failure happened before?',
      description:
        'Search the incident history — retros, lessons and decisions — for a failure signature, ' +
        'error string or symptom. Check this before debugging something that smells familiar, ' +
        'and before proposing a process change that may already have been tried and ruled on.',
      inputSchema: {
        signature: z.string().describe('Error text, symptom or short description of the failure.'),
        limit: z.number().int().min(1).max(25).optional().describe('Default 6.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ signature, limit = 6 }) => {
      const corpus = getCorpus();
      if (corpus.incidents.size === 0) {
        return json({
          signature,
          count: 0,
          note: 'This deployment has no incident sources configured (config key "incidents").',
        });
      }
      const hits = search(corpus.incidents, signature, { limit });
      return json({ signature, count: hits.length, incidents: hits });
    }
  );

  server.registerTool(
    'get_roster',
    {
      title: 'Get the project roster',
      description:
        'The projects this brain governs: repo, tracker key, local path, stack, status and owner. ' +
        'Use it to resolve "which board does X use" or "where does X live" without loading a doc.',
      inputSchema: {
        status: z.string().optional().describe('Filter, e.g. active | legacy | retired | archive.'),
        jira: z.string().optional().describe('Filter by tracker project key, e.g. SNAP.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ status, jira }) => {
      const corpus = getCorpus();
      if (!corpus.roster) {
        return json({ note: 'No roster configured (config key "roster").', projects: [] });
      }
      let projects = corpus.roster.projects || [];
      if (status) projects = projects.filter((p) => p.status === status);
      if (jira) projects = projects.filter((p) => p.jira === jira);
      return json({ ...corpus.roster, projects, count: projects.length });
    }
  );

  server.registerTool(
    'list_profiles',
    {
      title: 'List the available rule profiles',
      description: 'The operator-defined presets accepted by get_rules.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const corpus = getCorpus();
      return json({
        corpus: corpus.name,
        profiles: Object.entries(corpus.profiles).map(([name, preset]) => ({
          name,
          description: preset.description ?? null,
          filters: { applies: preset.applies, budget: preset.budget, kind: preset.kind },
        })),
      });
    }
  );
}
