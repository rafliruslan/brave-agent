import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  indexPathFor,
  appendRun,
  readIndex,
  groupBySession,
  readRange,
  indexPathIn,
} from './runs-index.mjs';

const tmp = () => mkdtemp(join(tmpdir(), 'runs-index-'));

test('the index sits beside the transcripts, not inside one', () => {
  assert.equal(indexPathFor('/ws/transcripts/abc.jsonl'), '/ws/transcripts/index.jsonl');
});

test('a turn records where it wrote', async () => {
  const path = join(await tmp(), 'index.jsonl');
  await appendRun(path, { session: 'abc', offset: 0, bytes: 120, at: '2026-09-10T10:00:00.000Z' });
  assert.deepEqual(await readIndex(path), [
    { session: 'abc', offset: 0, bytes: 120, at: '2026-09-10T10:00:00.000Z' },
  ]);
});

test('a turn that wrote nothing is not recorded', async () => {
  // Killed before its first kept line. A zero-length range points at nothing,
  // and recording it would make the turn count wrong as well.
  const path = join(await tmp(), 'index.jsonl');
  assert.equal(await appendRun(path, { session: 'abc', offset: 40, bytes: 0 }), false);
  assert.deepEqual(await readIndex(path), []);
});

test('a run with no session id is not recorded', async () => {
  const path = join(await tmp(), 'index.jsonl');
  assert.equal(await appendRun(path, { session: null, offset: 0, bytes: 10 }), false);
});

test('the index directory is created if it is not there yet', async () => {
  const path = join(await tmp(), 'nested', 'index.jsonl');
  await appendRun(path, { session: 'abc', offset: 0, bytes: 5 });
  assert.equal((await readFile(path, 'utf8')).includes('abc'), true);
});

test('no index at all reads as empty, so the listing can fall back', async () => {
  assert.deepEqual(await readIndex(join(await tmp(), 'missing.jsonl')), []);
});

test('a half-written final line costs that line, not the index', async () => {
  const path = join(await tmp(), 'index.jsonl');
  await writeFile(path, '{"session":"a","offset":0,"bytes":5,"at":"x"}\n{"session":"b","off');
  const entries = await readIndex(path);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].session, 'a');
});

test('turns are grouped per session and ordered by position in the file', async () => {
  const path = join(await tmp(), 'index.jsonl');
  await appendRun(path, { session: 'a', offset: 100, bytes: 50 });
  await appendRun(path, { session: 'b', offset: 0, bytes: 10 });
  await appendRun(path, { session: 'a', offset: 0, bytes: 100 });

  const grouped = groupBySession(await readIndex(path));
  assert.deepEqual(grouped.get('a').map((e) => e.offset), [0, 100]);
  assert.equal(grouped.get('b').length, 1);
});

test('a turn count is how many times the agent ran', async () => {
  // Not how many messages it produced. The listing counted assistant lines and
  // showed "183 turns" for a session that had run five times.
  const path = join(await tmp(), 'index.jsonl');
  for (const offset of [0, 100, 250]) await appendRun(path, { session: 'a', offset, bytes: 100 });
  assert.equal(groupBySession(await readIndex(path)).get('a').length, 3);
});

// --- reading one turn instead of the whole file ------------------------------

test('readRange returns exactly the turn asked for', async () => {
  const path = join(await tmp(), 't.jsonl');
  const first = '{"type":"user","message":{"content":"the first ask"}}\n';
  const second = '{"type":"user","message":{"content":"a later turn"}}\n';
  await writeFile(path, first + second);

  const got = await readRange(path, 0, Buffer.byteLength(first));
  assert.equal(got, first);
  assert.equal(got.includes('later turn'), false);
});

test('readRange starts where it is told', async () => {
  const path = join(await tmp(), 't.jsonl');
  const first = 'aaaa\n';
  await writeFile(path, `${first}bbbb\n`);
  assert.equal(await readRange(path, Buffer.byteLength(first), 5), 'bbbb\n');
});

test('a range past the end of the file returns what is there, not padding', async () => {
  // A transcript truncated or replaced out from under the index must not come
  // back as a buffer of NUL bytes pretending to be JSON.
  const path = join(await tmp(), 't.jsonl');
  await writeFile(path, 'short\n');
  assert.equal(await readRange(path, 0, 9999), 'short\n');
});

test('a missing transcript reads as empty rather than throwing', async () => {
  assert.equal(await readRange(join(await tmp(), 'gone.jsonl'), 0, 10), '');
});

test('a workspace names its own index', () => {
  assert.equal(indexPathIn('/ws'), '/ws/transcripts/index.jsonl');
  // and the two ways of naming it agree
  assert.equal(indexPathIn('/ws'), indexPathFor('/ws/transcripts/abc.jsonl'));
});
