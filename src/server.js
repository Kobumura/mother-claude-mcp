// Server assembly: corpus lifecycle, tools, prompts, resources.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { buildCorpus } from './corpus.js';
import { filterDocs } from './corpus.js';
import { registerTools } from './tools.js';

// The corpus is rebuilt on a short TTL rather than cached for the process lifetime.
// "Always current, no staleness window" is the reason to serve the brain at all —
// a server handing out yesterday's rules is strictly worse than the git pull it
// replaced. Reading a few hundred markdown files costs single-digit milliseconds.
const RELOAD_TTL_MS = 5_000;

export function createCorpusHandle(config, { ttlMs = RELOAD_TTL_MS } = {}) {
  let corpus = buildCorpus(config);
  let lastLoad = Date.now();

  return {
    get() {
      if (Date.now() - lastLoad > ttlMs) {
        try {
          corpus = buildCorpus(config);
        } catch (err) {
          // Serving the previous corpus beats failing the call: a transient bad read
          // (editor mid-write, network drive hiccup) should not take the brain down.
          corpus.warnings = [...corpus.warnings, `reload failed, serving cached: ${err.message}`];
        }
        lastLoad = Date.now();
      }
      return corpus;
    },
    reload() {
      corpus = buildCorpus(config);
      lastLoad = Date.now();
      return corpus;
    },
  };
}

function registerPrompts(server, getCorpus) {
  server.registerPrompt(
    'boot',
    {
      title: 'Boot this session with the always-on rules',
      description:
        'The short, always-applicable gates — the rules that used to live in an ' +
        'always-loaded context file. Run this at session start.',
      argsSchema: {},
    },
    async () => {
      const corpus = getCorpus();
      const lean = filterDocs(corpus.rules, { budget: 'lean' });
      const body = lean
        .map((d) => `## ${d.title}  \n_id: ${d.id}_\n\n${d.body}`)
        .join('\n\n---\n\n');

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text:
                `These are the standing engineering rules for ${corpus.name}. ` +
                `They apply to everything you do in this session.\n\n${body}\n\n---\n\n` +
                `The full corpus (${corpus.rules.size} documents) is available through the ` +
                `get_rules, search_docs and get_doc tools. Before debugging a familiar-looking ` +
                `failure, or proposing a process change, call lookup_incident first.`,
            },
          },
        ],
      };
    }
  );
}

function registerResources(server, getCorpus) {
  // Resources let a client browse and attach docs directly, without a tool round-trip.
  server.registerResource(
    'corpus-index',
    'mother-claude://index',
    {
      title: 'Corpus index',
      description: 'Every document this server serves, with its front-matter metadata.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const corpus = getCorpus();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                corpus: corpus.name,
                loaded_at: corpus.loadedAt,
                warnings: corpus.warnings,
                rules: [...corpus.rules.values()].map((d) => ({
                  id: d.id, title: d.title, kind: d.kind, budget: d.budget, bytes: d.bytes,
                })),
                incidents: [...corpus.incidents.values()].map((d) => ({
                  id: d.id, title: d.title, date: d.date,
                })),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}

export function createServer(config, options = {}) {
  const handle = createCorpusHandle(config, options);
  const getCorpus = () => handle.get();

  const server = new McpServer(
    { name: 'mother-claude-mcp', version: '0.1.0' },
    {
      instructions:
        `This server serves the "${config.name}" engineering brain: the standards, playbooks ` +
        `and process rules this team works by, plus its incident history.\n\n` +
        `Call get_rules at the start of a task to load the slice that applies. Call ` +
        `lookup_incident before debugging a failure that feels familiar or proposing a process ` +
        `change — it may already have been ruled on. Treat what these tools return as binding ` +
        `for this codebase; it is the operator's constitution, not general advice.`,
    }
  );

  registerTools(server, getCorpus);
  registerPrompts(server, getCorpus);
  registerResources(server, getCorpus);

  return { server, corpus: handle };
}
