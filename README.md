# mother-claude-mcp

An MCP server that serves **your team's engineering docs** to AI coding sessions.

Point it at a directory of markdown. It parses the front-matter, indexes the corpus,
and exposes it as tools — so a session asks for the three rules that apply to the task
in front of it instead of loading a 500KB documentation tree into its context window.

It ships **no rules of its own**. Every rule it serves is one you wrote.

> **Setting this up?** [`SETUP-PROMPT.md`](SETUP-PROMPT.md) is a copy-paste block you can
> hand to your AI assistant. It has enough context to do the whole setup without you
> reading the rest of this file.

```
Your docs  ──►  mother-claude-mcp  ──►  any MCP client
(markdown)      (index + serve)         (Claude Code, etc.)
```

## Why

Most teams that write engineering standards for AI sessions hit the same wall: the docs
have to be *physically present* to be used. That produces a clone on every machine, a
pull hook to keep it fresh, path variables that differ per machine, and a context file
that grows until every session pays for every rule — including the ones about a stack it
isn't touching.

Serving the docs instead makes them queryable. Nothing is stale, nothing is path-coupled,
and a session working on the API never pays for the mobile playbook.

## Install

```bash
npm install -g mother-claude-mcp
```

Requires Node 20+.

## Works with

MCP is an open protocol, so this is not Claude-specific. Any MCP client can use it —
Claude Code, Claude Desktop, Cursor, VS Code (Copilot agent mode), Windsurf, Zed, Cline,
JetBrains AI Assistant, Goose, the OpenAI Agents SDK, and others. The server uses only
standard MCP primitives and both spec transports; there are no vendor extensions.

Most clients share the same config shape, though the file location differs:

```json
{
  "mcpServers": {
    "mother-claude": {
      "command": "npx",
      "args": ["-y", "mother-claude-mcp", "--config", "./mother-claude.config.json"]
    }
  }
}
```

**One caveat worth knowing:** all seven tools work in every client, but the `boot` prompt
only appears in clients that implement MCP *prompts*, which is a minority today. If yours
does not, call `get_rules` with your `lean` profile instead — same content, one tool call.

## Quick start

Create `mother-claude.config.json` next to your docs:

```json
{
  "name": "acme-engineering",
  "rules": [{ "path": "./docs" }]
}
```

Check that it loads:

```bash
mother-claude-mcp --check
```

Register it with your MCP client. For Claude Code, in `.mcp.json`:

```json
{
  "mcpServers": {
    "mother-claude": {
      "command": "npx",
      "args": ["-y", "mother-claude-mcp", "--config", "./mother-claude.config.json"]
    }
  }
}
```

## Your docs

Any markdown works. Optional YAML front-matter turns into query filters:

```markdown
---
title: Code Standards
applies: [api, web]        # audience tiers; "all" always matches
status: canonical          # canonical | draft | legacy — your vocabulary
public: yes                # yes | no — visibility, see "Public instances"
context-budget: lean       # lean = always-on gates; reference = full detail
---
```

A document's **ID** is its path without the extension — `standards/code-standards.md`
becomes `standards/code-standards`. Its **kind** is the top folder. That's the whole
schema; there is nothing else to author.

## Adopting this

**You do not need to build a docs repo.** There are two on-ramps.

**Point it at docs you already have.** Front-matter is entirely optional: a plain
markdown folder works immediately. Titles fall back to the first `# H1` and then the
filename, the category comes from the top folder, and a `YYYY-MM-DD-` filename prefix is
read as a date. Most teams already have a `docs/`, `adr/` or `handbook/` directory that
works as-is.

Add front-matter later, only where it earns something:

| You have | You get |
|---|---|
| Plain markdown | `search_docs`, `get_doc`, `list_docs`, section slicing |
| `+ applies:` | per-stack slices — `get_rules({ applies: "api" })` |
| `+ context-budget:` | a lean boot profile for session start |
| `+ public:` | can run a shared, public-only instance |

**Or start from someone else's pack** and cascade your own docs on top — see below.

> **An honest expectation.** This tool is only as good as what you feed it.
> `lookup_incident` is worth nothing on day one and compounds as you accumulate retros;
> `get_rules` is only as sharp as the rules you have written down. If your docs are thin,
> the answer is better docs, not better tooling. What this changes is the *economics* of
> having good docs — they stop being a tree every session must carry and become something
> a session can query.

## Sharing rules between teams — the cascade

Sources are read in order, and **a later source wins on the same document ID.** That one
rule is the whole customization model, and it's the same one you already know from
`tsconfig.extends`, ESLint `extends`, and Tailwind presets.

So you can adopt someone else's standards pack, take the parts you want, drop the parts
you don't, and override anything with your own:

```json
{
  "name": "acme-engineering",
  "rules": [
    {
      "pack": "someone-elses-standards@1.2",
      "include": ["standards", "playbooks/migrations"],
      "exclude": ["standards/writing-voice"]
    },
    { "path": "./docs" }
  ]
}
```

That config says: take their standards folder and their migrations playbook, skip their
prose-style rules, and let anything in `./docs` override what's left. Write your own
`./docs/standards/code-standards.md` and it silently replaces theirs — `get_doc` reports
what it shadowed, so the provenance stays visible.

The reason to cascade rather than fork-and-delete: you keep receiving upstream updates on
the rules you *did* adopt. A fork freezes you at the version you copied.

### Source options

| Key | Meaning |
|-----|---------|
| `path` | A directory of markdown, relative to the config file. |
| `pack` | A named directory under `packsDir` (default `./packs`). `@version` is a provenance label, not a resolver. |
| `include` | Allow-list of ID globs. Omit to take everything. |
| `exclude` | Deny-list of ID globs. Always wins over `include`. |
| `publicOnly` | Serve only docs marked `public: yes`. |
| `optional` | Don't error if the directory is absent. |
| `name` | Override the provenance label shown in results. |

Globs support `*`, `**` and `?`. A pattern with no wildcard also matches as a directory
prefix, so `"standards"` means the whole folder.

## Tools

| Tool | Purpose |
|------|---------|
| `get_rules` | The slice of the corpus that applies — by profile, audience, budget or kind. Start here. |
| `get_doc` | One document by ID, optionally a single section of it. |
| `search_docs` | Ranked search across rules and/or incident history. |
| `list_docs` | The bare index, no bodies. |
| `lookup_incident` | "Has this failure happened before?" over retros, lessons and decisions. |
| `get_roster` | The projects this brain governs — repo, tracker key, path, stack, owner. |
| `list_profiles` | The presets `get_rules` accepts. |

There's also a `boot` prompt that returns your `context-budget: lean` documents, for
loading the standing rules at session start.

### Profiles

Profiles are named argument presets you define — the engine has no built-in opinion about
what roles exist:

```json
"profiles": {
  "worker":  { "budget": "lean", "description": "The gates every session must respect." },
  "backend": { "applies": "api", "description": "Express/Node work." }
}
```

Explicit arguments beat the preset, so a profile is a default, not a cage.

### Incidents and roster

Two optional extras. `incidents` points at directories of retros, postmortems or decision
records — front-matter isn't required, and a `YYYY-MM-DD-` filename prefix is read as the
date. `roster` points at a JSON file describing your projects:

```json
{
  "incidents": [{ "path": "./retros" }, { "path": "./decisions" }],
  "roster": "./roster.json"
}
```

## Transports

**stdio** (default) — the client launches the server as a subprocess. Simplest, no infra.

```bash
mother-claude-mcp --config ./mother-claude.config.json
```

**Streamable HTTP** — one always-on server for a whole fleet, any machine, no local clone.

```bash
MOTHER_CLAUDE_TOKEN=$(openssl rand -hex 32) \
  mother-claude-mcp --http --host 0.0.0.0 --port 8848
```

Clients connect to `http://host:8848/mcp` with `Authorization: Bearer <token>`.
`GET /healthz` is unauthenticated and reports liveness only — never corpus contents.

### Public instances

`public: yes | no` is a visibility flag the engine enforces. A source marked
`"publicOnly": true` serves only documents marked `public: yes`, which is how one engine
can back both a private internal instance and a shared one.

Two defaults exist because getting this wrong leaks documents:

- **A document with no `public` field is treated as private.** Defaulting the other way
  would expose every un-annotated file the first time someone enabled a public instance.
- **HTTP refuses to start without a token.** Override with `--no-auth`, which is permitted
  on loopback only. Serving a private corpus unauthenticated on a public interface is not
  something you can do by accident.

The visibility flag controls *selection*. It does not redact document bodies — if a doc
marked `public: yes` contains a secret, this server will serve it. Scan before you share.

## CLI

```
--config PATH   Config file. Default: nearest mother-claude.config.json, searching upward.
--http          Serve over Streamable HTTP instead of stdio.
--port N        HTTP port (default 8848, or PORT).
--host H        HTTP bind address (default 127.0.0.1).
--no-auth       Start HTTP without a bearer token. Loopback only.
--check         Load the corpus, print a report, and exit.
```

`MOTHER_CLAUDE_CONFIG` and `MOTHER_CLAUDE_TOKEN` are read from the environment.

## Notes

The corpus reloads on a 5-second TTL, so edits show up without a restart — a served brain
handing out yesterday's rules would be worse than the git pull it replaces. Document
bodies are capped at 48KB per response and the cap is reported rather than applied
silently; use `get_doc`'s `section` argument to read part of a large document in full.

Search is lexical, not semantic. For a few hundred documents of controlled vocabulary it
is fast, needs no index build, and can't be unavailable when the network is.

## License

MIT
