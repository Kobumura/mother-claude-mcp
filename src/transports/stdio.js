// stdio transport — the local case, and the default.
//
// stdout is the JSON-RPC channel: anything written there that is not a protocol
// message corrupts the stream. All diagnostics go to stderr.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from '../server.js';

export async function startStdio(config) {
  const { server, corpus } = createServer(config);
  const loaded = corpus.get();

  for (const warning of loaded.warnings) {
    process.stderr.write(`[mother-claude-mcp] warning: ${warning}\n`);
  }
  process.stderr.write(
    `[mother-claude-mcp] "${loaded.name}" ready on stdio — ` +
    `${loaded.rules.size} rules, ${loaded.incidents.size} incidents\n`
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  return server;
}
