#!/usr/bin/env node
// Entry point. Resolves a config, then hands off to a transport.

import { findConfig, loadConfig, ConfigError } from './config.js';
import { startStdio } from './transports/stdio.js';
import { startHttp } from './transports/http.js';

const USAGE = `mother-claude-mcp — serve your team's engineering docs to AI coding sessions

  mother-claude-mcp [--config PATH] [--http] [--port N] [--host H] [--no-auth]

  --config PATH   Config file. Default: nearest mother-claude.config.json,
                  searching upward from the working directory.
  --http          Serve over Streamable HTTP instead of stdio.
  --port N        HTTP port (default 8848, or PORT).
  --host H        HTTP bind address (default 127.0.0.1).
  --no-auth       Start HTTP without a bearer token. Loopback only.
  --check         Load the corpus, print a report, and exit.
  --help          This text.

Environment:
  MOTHER_CLAUDE_CONFIG   Config path (overridden by --config).
  MOTHER_CLAUDE_TOKEN    Bearer token required by the HTTP transport.
`;

function parseArgs(argv) {
  const args = { port: null, host: null, config: null, http: false, noAuth: false, check: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--help': case '-h': args.help = true; break;
      case '--http': args.http = true; break;
      case '--no-auth': args.noAuth = true; break;
      case '--check': args.check = true; break;
      case '--config': args.config = argv[++i]; break;
      case '--port': args.port = Number(argv[++i]); break;
      case '--host': args.host = argv[++i]; break;
      default:
        throw new Error(`unknown argument "${arg}" (try --help)`);
    }
  }
  return args;
}

function resolveConfigPath(explicit) {
  const candidate = explicit || process.env.MOTHER_CLAUDE_CONFIG || findConfig();
  if (!candidate) {
    throw new ConfigError(
      'no config found. Create a mother-claude.config.json, or pass --config PATH. ' +
      'See mother-claude.config.example.json.'
    );
  }
  return candidate;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(USAGE);
    return;
  }

  const config = loadConfig(resolveConfigPath(args.config));

  if (args.check) {
    const { buildCorpus } = await import('./corpus.js');
    const corpus = buildCorpus(config);
    const publicCount = [...corpus.rules.values()].filter((d) => d.public).length;
    process.stdout.write(
      `corpus:    ${corpus.name}\n` +
      `config:    ${config.path}\n` +
      `rules:     ${corpus.rules.size} (${publicCount} public, ${corpus.rules.size - publicCount} private)\n` +
      `incidents: ${corpus.incidents.size}\n` +
      `roster:    ${corpus.roster ? `${corpus.roster.projects.length} projects` : 'none'}\n` +
      `profiles:  ${Object.keys(corpus.profiles).join(', ') || 'none'}\n` +
      (corpus.warnings.length
        ? `warnings:\n${corpus.warnings.map((w) => `  - ${w}`).join('\n')}\n`
        : 'warnings:  none\n')
    );
    return;
  }

  if (args.http) {
    await startHttp(config, {
      port: args.port || Number(process.env.PORT) || 8848,
      host: args.host || '127.0.0.1',
      token: process.env.MOTHER_CLAUDE_TOKEN || null,
      allowNoAuth: args.noAuth,
    });
  } else {
    await startStdio(config);
  }
}

main().catch((err) => {
  const message = err instanceof ConfigError ? err.message : err.stack || String(err);
  process.stderr.write(`[mother-claude-mcp] ${message}\n`);
  process.exit(1);
});
