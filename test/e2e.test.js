// End-to-end: drive the server through a real MCP client over stdio, then over HTTP.
// Asserts observable protocol behaviour, not internals.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { loadConfig } from '../src/config.js';
import { startHttp } from '../src/transports/http.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CONFIG = join(HERE, 'fixture', 'mother-claude.config.json');

const parse = (result) => JSON.parse(result.content[0].text);

async function withStdioClient(fn) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(ROOT, 'src', 'cli.js'), '--config', CONFIG],
  });
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

test('stdio: lists the expected tool surface', async () => {
  await withStdioClient(async (client) => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      'get_doc', 'get_roster', 'get_rules', 'list_docs',
      'list_profiles', 'lookup_incident', 'search_docs',
    ]);
  });
});

test('cascade: a later source overrides an earlier one on the same id', async () => {
  await withStdioClient(async (client) => {
    const result = await client.callTool({ name: 'get_doc', arguments: { id: 'standards/code-standards' } });
    const doc = parse(result);
    // The fixture's local source redefines this id; the base pack version must lose.
    assert.equal(doc.source, 'local');
    assert.match(doc.body, /Local override/);
    assert.equal(doc.shadows.length, 1, 'the shadowed base version should be recorded');
    assert.equal(doc.shadows[0].source, 'base-pack');
  });
});

test('cascade: exclude drops a doc the base pack provides', async () => {
  await withStdioClient(async (client) => {
    const { docs } = parse(await client.callTool({ name: 'list_docs', arguments: {} }));
    const ids = docs.map((d) => d.id);
    assert.ok(ids.includes('standards/code-standards'), 'adopted rule should be present');
    assert.ok(!ids.includes('standards/writing-voice'), 'excluded rule should be absent');
  });
});

test('get_rules: profile presets filter, and explicit args beat the preset', async () => {
  await withStdioClient(async (client) => {
    const lean = parse(await client.callTool({ name: 'get_rules', arguments: { profile: 'worker' } }));
    assert.ok(lean.count > 0);
    assert.ok(lean.docs.every((d) => d.budget === 'lean'));

    const overridden = parse(
      await client.callTool({ name: 'get_rules', arguments: { profile: 'worker', budget: 'reference' } })
    );
    assert.ok(overridden.docs.every((d) => d.budget === 'reference'));
  });
});

test('get_rules: unknown profile is a clean error listing what exists', async () => {
  await withStdioClient(async (client) => {
    const result = await client.callTool({ name: 'get_rules', arguments: { profile: 'nope' } });
    assert.equal(result.isError, true);
    const body = parse(result);
    assert.match(body.error, /unknown profile/);
    assert.ok(body.available.includes('worker'));
  });
});

test('get_rules: bodies are excluded unless asked for', async () => {
  await withStdioClient(async (client) => {
    const withoutBody = parse(await client.callTool({ name: 'get_rules', arguments: {} }));
    assert.ok(withoutBody.docs.every((d) => d.body === undefined));

    const withBody = parse(await client.callTool({ name: 'get_rules', arguments: { include_body: true } }));
    assert.ok(withBody.docs.every((d) => typeof d.body === 'string'));
  });
});

test('get_doc: section slicing returns just that section', async () => {
  await withStdioClient(async (client) => {
    const doc = parse(
      await client.callTool({ name: 'get_doc', arguments: { id: 'standards/code-standards', section: 'Testing' } })
    );
    assert.equal(doc.section, 'Testing');
    assert.match(doc.body, /## Testing/);
    assert.ok(!/## Naming/.test(doc.body), 'should not bleed into the next section');
  });
});

test('get_doc: unknown id suggests near matches instead of failing blankly', async () => {
  await withStdioClient(async (client) => {
    const result = await client.callTool({ name: 'get_doc', arguments: { id: 'standards/code-standard' } });
    assert.equal(result.isError, true);
    const body = parse(result);
    assert.ok(body.did_you_mean.includes('standards/code-standards'));
  });
});

test('search_docs: ranks a title match above an incidental body mention', async () => {
  await withStdioClient(async (client) => {
    const { rules } = parse(await client.callTool({ name: 'search_docs', arguments: { query: 'migrations' } }));
    assert.ok(rules.length > 0);
    assert.equal(rules[0].id, 'playbooks/migrations');
  });
});

test('lookup_incident: finds a past failure by symptom', async () => {
  await withStdioClient(async (client) => {
    const body = parse(
      await client.callTool({ name: 'lookup_incident', arguments: { signature: 'collation 1267' } })
    );
    assert.ok(body.count > 0);
    assert.equal(body.incidents[0].id, '2026-01-02-mixed-collation');
  });
});

test('get_roster: filters by status', async () => {
  await withStdioClient(async (client) => {
    const all = parse(await client.callTool({ name: 'get_roster', arguments: {} }));
    assert.equal(all.count, 2);
    const active = parse(await client.callTool({ name: 'get_roster', arguments: { status: 'active' } }));
    assert.equal(active.count, 1);
  });
});

test('boot prompt carries the lean rules', async () => {
  await withStdioClient(async (client) => {
    const { prompts } = await client.listPrompts();
    assert.ok(prompts.some((p) => p.name === 'boot'));
    const result = await client.getPrompt({ name: 'boot', arguments: {} });
    assert.match(result.messages[0].content.text, /Never force-push/);
  });
});

test('http: rejects a missing or wrong bearer token, accepts the right one', async () => {
  const config = loadConfig(CONFIG);
  const server = await startHttp(config, {
    port: 0, host: '127.0.0.1', token: 'correct-horse', allowNoAuth: false,
  });
  const { port } = server.address();
  const url = new URL(`http://127.0.0.1:${port}/mcp`);

  try {
    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(health.status, 200);

    const anonymous = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.equal(anonymous.status, 401, 'no token must be rejected');

    const wrong = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: 'Bearer wrong-horse',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.equal(wrong.status, 401, 'a wrong token must be rejected');

    const client = new Client({ name: 'test-http', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { authorization: 'Bearer correct-horse' } },
      })
    );
    const { tools } = await client.listTools();
    assert.ok(tools.length >= 7);
    const roster = parse(await client.callTool({ name: 'get_roster', arguments: {} }));
    assert.equal(roster.count, 2);
    await client.close();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('http: refuses to start unauthenticated on a non-loopback interface', async () => {
  const config = loadConfig(CONFIG);
  await assert.rejects(
    startHttp(config, { port: 0, host: '0.0.0.0', token: null, allowNoAuth: true }),
    /only permitted on loopback/
  );
});

test('http: refuses to start with no token and no explicit opt-out', async () => {
  const config = loadConfig(CONFIG);
  await assert.rejects(
    startHttp(config, { port: 0, host: '127.0.0.1', token: null, allowNoAuth: false }),
    /Refusing to start HTTP without a token/
  );
});
