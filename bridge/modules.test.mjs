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

/**
 * Every sibling export that index.mjs USES, it must also import.
 *
 * index.mjs is checked with --check rather than imported, because importing it
 * opens a Slack socket. --check is a syntax check: it happily accepts a call to
 * a name that does not exist. That gap shipped a bridge whose every run died on
 * "createRunRegistry is not defined", with the launchd service restarting into
 * the same crash every 30 seconds.
 *
 * So: for each module in this directory, take its exported names, see which of
 * them index.mjs references, and require that those are imported from it.
 */
test('index.mjs imports every sibling export it uses', async () => {
  const index = await readFile(new URL('index.mjs', HERE), 'utf8');

  // What index.mjs imports, by name.
  const imported = new Set();
  for (const m of index.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (name) imported.add(name);
    }
  }

  const files = (await readdir(HERE)).filter(
    (f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs') && f !== 'index.mjs',
  );

  const missing = [];
  for (const f of files) {
    const src = await readFile(new URL(f, HERE), 'utf8');
    for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z_$][\w$]*)/gm)) {
      const name = m[1];
      if (imported.has(name)) continue;
      // Used as a call, a constructor, or a bare reference followed by a token
      // that means "this is being evaluated".
      const used = new RegExp(`(?<![\\w$.])${name}\\s*[({]`).test(index);
      if (used) missing.push(`${name} (exported by ${f})`);
    }
  }

  assert.deepEqual(missing, [], `index.mjs uses these without importing them:\n  ${missing.join('\n  ')}`);
});
