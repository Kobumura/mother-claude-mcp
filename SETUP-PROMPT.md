# Setup prompt

**Copy everything in the box below and paste it to your AI coding assistant.** It has
enough context to set this up for you without asking you to read the rest of the docs.

Works with any assistant that can edit files and run commands — Claude Code, Cursor,
Copilot agent mode, Windsurf, Cline, Zed, and others.

---

```text
I want to set up mother-claude-mcp, an MCP server that serves our team's engineering
docs to AI coding sessions so you can look up the rules that apply to a task instead of
me pasting them, or you loading a whole docs tree into context.

Here is everything you need to know about it.

WHAT IT IS
An MCP server (Node 20+, MIT) that reads directories of markdown and exposes them as
tools. It ships NO rules of its own — it serves whatever docs I point it at.

Repo: https://github.com/Kobumura/mother-claude-mcp

TOOLS IT EXPOSES
  get_rules       the slice of our docs that applies to a task (start here)
  get_doc         one document by id, or a single section of it
  search_docs     ranked search across the corpus
  list_docs       the bare index, no bodies
  lookup_incident search past retros/postmortems for a failure signature
  get_roster      our projects: repo, tracker key, path, stack, owner
  list_profiles   the named presets get_rules accepts
Plus a `boot` prompt that returns the always-on rules.

WHAT I WANT YOU TO DO

1. Find our documentation. Look for directories of markdown — likely candidates are
   docs/, documentation/, adr/, rfcs/, handbook/, wiki/, standards/, or a sibling docs
   repo. Tell me what you found and confirm with me before continuing. If we have
   nothing, say so — this tool is not worth setting up over three README files.

2. Create mother-claude.config.json at the root of the repo I'm working in:

   {
     "name": "<our team or product name>",
     "rules": [{ "path": "./docs" }]
   }

   Adjust the path to whatever you found. Multiple sources are allowed and load in
   order; a later source WINS on the same document id, which is how a shared pack gets
   overridden by our own files.

   Optional extras, only if we actually have these:
     "incidents": [{ "path": "./retros" }]   directories of postmortems/retros/decisions
     "roster": "./roster.json"               structured project list

3. Verify it loads:
     npx mother-claude-mcp --config ./mother-claude.config.json --check
   It prints the document count and any warnings. Show me the output.

4. Register the server with whatever assistant/editor I'm using. For Claude Code:
     claude mcp add mother-claude -- npx -y mother-claude-mcp --config ./mother-claude.config.json
   Add `--scope user` if I want it available in every project, not just this one.
   For other clients, add this to the mcpServers block of their MCP config file:
     "mother-claude": {
       "command": "npx",
       "args": ["-y", "mother-claude-mcp", "--config", "./mother-claude.config.json"]
     }

5. Tell me it's ready, and show me one real example — call get_rules or search_docs
   against our actual docs and show me what came back. Do not tell me it works without
   showing me output from OUR documents.

FRONT-MATTER IS OPTIONAL — DO NOT BULK-EDIT OUR DOCS
Plain markdown works immediately. The server derives a title from the first H1 (or the
filename) and a category from the top folder. Do NOT go add YAML headers to all our
files as part of setup. That is a separate decision I want to make deliberately.

If we later want filtering, these keys are what the server understands:
  applies: [api, web]        audience tiers; "all" always matches
  context-budget: lean       lean = always-on gates; reference = full detail
  status: canonical          canonical | draft | legacy — our vocabulary
  public: yes                yes | no — visibility, only matters for a shared instance

WHAT MATTERS AFTER SETUP
Call get_rules at the start of a task rather than assuming you know our conventions.
Call lookup_incident before debugging something that feels familiar, or before
proposing a process change — we may have ruled on it already.

One caveat so we both have the right expectations: this tool is only as good as what we
feed it. lookup_incident is worth nothing on day one and compounds as we add retros. If
our docs are thin, the honest answer is to improve the docs, not the tooling.
```

---

## After it's running

Ask your assistant things you'd otherwise have to explain:

- *"What are our testing requirements for this service?"* → `get_rules` / `search_docs`
- *"Have we hit this migration error before?"* → `lookup_incident`
- *"Which board does this project use?"* → `get_roster`
- *"Read just the deployment section of our standards."* → `get_doc` with `section`

## If you want to adopt someone else's rules too

Sources cascade — later wins on the same document id, and each source takes
`include`/`exclude` globs. So you can take part of a shared pack, drop what doesn't fit,
and override anything with your own file at the same id:

```json
{
  "rules": [
    { "pack": "some-starter@1.0", "include": ["standards"], "exclude": ["standards/writing-voice"] },
    { "path": "./docs" }
  ]
}
```

Unlike forking, you keep receiving upstream updates on the rules you actually adopted.
