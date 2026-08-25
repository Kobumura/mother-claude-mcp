# mother-claude-mcp — project context

Context for an AI assistant working on this repo.

> **This repository is PUBLIC.** Nothing here may name a private repo, an internal
> tracker key, a machine path, a hostname, an IP, or a person's contact details. The
> engine is deliberately content-agnostic; keeping this file free of any one team's
> specifics is part of that.

## What this is

An MCP server that serves a directory of markdown to AI coding sessions as tools. It
**ships no rules of its own** — every rule it serves belongs to whoever configured it.

Node 20+, ES modules, MIT. No build step, no TypeScript, no framework.

## Architecture

```
src/
  cli.js         entry point: arg parsing, then hands off to a transport
  config.js      cascade config loader
  corpus.js      walk, parse, merge sources, filter
  frontmatter.js YAML-subset parser (deliberately not full YAML)
  glob.js        include/exclude matching on doc IDs
  search.js      lexical ranking, dependency-free
  server.js      corpus lifecycle, tools/prompts/resources registration
  tools.js       the seven tool definitions
  transports/    stdio.js and http.js
```

**The cascade is the core idea.** Sources load in declared order; a later source wins on
the same document ID; each source takes `include`/`exclude` globs. That single rule is
the entire customization model. Shadowed documents are recorded on the winner so
provenance stays inspectable. Do not replace this with a merge strategy or a config
schema — the point is that it needs no explanation to anyone who has used
`tsconfig.extends`.

## Rules specific to this repo

- **Never bake in rules.** No default corpus, no opinionated profiles, no built-in role
  names. If a change makes the engine assume what documents exist, it is wrong.
- **Two safety defaults are load-bearing** — both exist because getting them wrong leaks
  documents, and both must survive refactors:
  - a document with **no `public` field is treated as private**;
  - **HTTP refuses to start without a bearer token**, and `--no-auth` is permitted on
    loopback only.
- **Read-only.** Every tool carries `readOnlyHint`. A write path (e.g. filing a lesson)
  is a separate decision, not a quiet addition.
- **No new runtime dependencies without a real reason.** Search is lexical rather than
  embedding-based on purpose: the corpora are small and controlled, the index must
  rebuild instantly, and a docs server that needs a model to answer "where is the
  migration rule" is unavailable exactly when the network is.
- **Tools return compact JSON, not prose.** The whole point is to stop paying for a
  corpus on every call; a tool that answers with three pages when the caller wanted a
  filename defeats it. Index tools return metadata; callers opt into bodies.

## Testing

```bash
npm test          # node --test — drives a REAL MCP client over both transports
```

Tests assert observable protocol behaviour, not internals. `test/fixture/` contains a
deliberately small corpus that exercises the cascade: a base pack, a local source that
overrides one document ID, and an excluded document. If you change cascade semantics,
that fixture is where it should show up first.

Use bare `node --test` — `node --test test/` resolves the directory as a module path on
Linux and fails, though Windows tolerates it.

## Deployment

`deploy/` carries a hardened systemd unit, a corpus refresh timer, and an nginx snippet
for running an always-on instance behind TLS. Two things there are scar tissue:

- **`MemoryDenyWriteExecute` is deliberately absent** from the unit. V8's JIT needs
  writable-then-executable pages, so enabling it makes Node core-dump at startup with
  SIGTRAP. Do not re-add it as "hardening".
- **`proxy_set_header Connection ""` is deliberately absent** from the nginx snippet.
  Some panels strip quotes when writing the vhost config, turning it into a
  one-argument directive that nginx rejects. It only enables upstream keepalive, which
  this does not need.

## Docs for humans

- `README.md` — the full user-facing reference.
- `SETUP-PROMPT.md` — a copy-paste block someone hands to their own AI assistant. If you
  change the config shape or the tool surface, update it in the same commit; it is the
  first thing a new adopter uses.
