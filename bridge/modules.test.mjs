import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const HERE = new URL('.', import.meta.url);

/**
 * Every module must at least parse.
 *
 * thread.mjs shipped a syntax error: an unescaped backtick inside the template
 * literal that locationNote returns, which closed the string early. The whole
 * suite stayed green because no test imported that file, and the bridge then
 * crash-looped under launchd on the next restart.
 *
 * A test per module is not the answer. A test that every module parses is.
 *
 * Two ways of checking, because the files are two kinds of thing. A library is
 * imported, which parses AND evaluates it, catching a bad top-level statement
 * too. An entrypoint with a shebang is checked in a subprocess instead:
 * importing dream.mjs or observe.mjs would run the job.
 */
async function listModules() {
  const files = (await readdir(HERE)).filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs'));
  const libs = [];
  const bins = [];
  for (const f of files) {
    const head = (await readFile(new URL(f, HERE), 'utf8')).slice(0, 2);
    (head === '#!' || f === 'index.mjs' ? bins : libs).push(f);
  }
  return { libs, bins };
}

test('every library module parses and evaluates', async () => {
  const { libs } = await listModules();
  assert.ok(libs.length > 5, `expected to find the libraries, saw ${libs.length}`);
  for (const f of libs) {
    await assert.doesNotReject(() => import(new URL(f, HERE).href), `${f} failed to load`);
  }
});

// index.mjs is here rather than above because importing it opens a Slack socket.
test('every entrypoint parses', async () => {
  const { bins } = await listModules();
  assert.ok(bins.includes('index.mjs'), 'index.mjs should be checked as an entrypoint');
  for (const f of bins) {
    await assert.doesNotReject(
      () => run(process.execPath, ['--check', fileURLToPath(new URL(f, HERE))]),
      `${f} does not parse`,
    );
  }
});
