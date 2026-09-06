import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const HERE = new URL('./', import.meta.url);

/**
 * The same guard bridge/modules.test.mjs carries, for the same reason: a module
 * that does not parse fails at MCP handshake time, where the only symptom the
 * agent gets is a browser or a memory that silently is not there.
 *
 * server.mjs is checked rather than imported, because importing it connects a
 * stdio transport and the test would then wait for a client that never comes.
 */
test('search.mjs parses and evaluates', async () => {
  await assert.doesNotReject(() => import(new URL('search.mjs', HERE).href));
});

test('server.mjs parses', async () => {
  await assert.doesNotReject(
    () => run(process.execPath, ['--check', fileURLToPath(new URL('server.mjs', HERE))]),
    'server.mjs does not parse',
  );
});
