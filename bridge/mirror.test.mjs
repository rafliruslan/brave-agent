import test from 'node:test';
import assert from 'node:assert/strict';
import { keepLine, splitLines, resultOf } from './mirror.mjs';

const obj = (o) => JSON.stringify(o);

test('the conversation is kept', () => {
  assert.equal(keepLine({ type: 'assistant', message: {} }), true);
  assert.equal(keepLine({ type: 'user', message: {} }), true);
  assert.equal(keepLine({ type: 'result', subtype: 'success' }), true);
});

test('system/init is kept, since it records what the run was given', () => {
  // model, tools, mcp_servers, cwd, permissionMode. Worth having when asking
  // later why a turn behaved the way it did.
  assert.equal(keepLine({ type: 'system', subtype: 'init' }), true);
});

test('hook chatter is dropped', () => {
  // Measured on a real one-line run: 13 of 17 lines were hooks.
  for (const subtype of ['hook_started', 'hook_response', 'hook_progress']) {
    assert.equal(keepLine({ type: 'system', subtype }), false, subtype);
  }
});

test('other non-conversation events are dropped', () => {
  assert.equal(keepLine({ type: 'rate_limit_event' }), false);
});

test('anything unrecognised is dropped rather than guessed at', () => {
  assert.equal(keepLine({ type: 'something_new_in_a_later_cli' }), false);
  assert.equal(keepLine(null), false);
  assert.equal(keepLine({}), false);
});

test('splitLines returns whole lines and keeps the remainder', () => {
  const { lines, rest } = splitLines('', 'a\nb\nc');
  assert.deepEqual(lines, ['a', 'b']);
  assert.equal(rest, 'c');
});

test('a line split across two chunks is rejoined', () => {
  // The stream arrives in arbitrary chunks; a JSON object routinely straddles
  // two of them, and parsing a half object would drop a real message.
  const first = splitLines('', '{"type":"assis');
  assert.deepEqual(first.lines, []);
  const second = splitLines(first.rest, 'tant"}\n');
  assert.deepEqual(second.lines, ['{"type":"assistant"}']);
  assert.equal(second.rest, '');
});

test('a trailing newline leaves nothing buffered', () => {
  const { lines, rest } = splitLines('', 'a\n');
  assert.deepEqual(lines, ['a']);
  assert.equal(rest, '');
});

test('an unterminated final line stays buffered, never emitted', () => {
  // A run killed by !stop ends mid-line. Emitting that half line would write
  // corrupt JSON into a transcript we are claiming to own.
  const { lines, rest } = splitLines('', '{"type":"assistant"}\n{"type":"res');
  assert.deepEqual(lines, ['{"type":"assistant"}']);
  assert.equal(rest, '{"type":"res');
});

test('resultOf finds the result line', () => {
  const r = resultOf([{ type: 'assistant' }, { type: 'result', subtype: 'success', result: 'ok' }]);
  assert.equal(r.result, 'ok');
});

test('resultOf returns null when the run never produced one', () => {
  // Exactly what a killed run looks like, and the caller must tell that apart
  // from a run that finished badly.
  assert.equal(resultOf([{ type: 'assistant' }]), null);
});

test('resultOf takes the last result if the CLI ever emits more than one', () => {
  const r = resultOf([
    { type: 'result', subtype: 'success', result: 'first' },
    { type: 'result', subtype: 'success', result: 'second' },
  ]);
  assert.equal(r.result, 'second');
});

// --- the writer -------------------------------------------------------------

import { createMirror, transcriptPathFor } from './mirror.mjs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = () => mkdtemp(join(tmpdir(), 'mirror-'));

test('collecting is synchronous, so no line can arrive before the mirror exists', () => {
  // An earlier version opened the file first and only then took lines. The
  // CLI's opening chunks won that race and the init line was lost from every
  // transcript.
  const m = createMirror();
  assert.equal(typeof m.take, 'function');
  assert.equal(m.take(obj({ type: 'assistant', message: {} })).type, 'assistant');
});

test('the offset is the file length before the turn', async () => {
  const path = join(await tmp(), 's1.jsonl');
  await writeFile(path, '{"type":"result"}\n');
  const m = createMirror();
  m.take(obj({ type: 'assistant', message: {} }));
  assert.equal((await m.writeTo(path)).offset, 18);
});

test('a new transcript starts at zero, and its directory is made', async () => {
  const path = join(await tmp(), 'nested', 'new.jsonl');
  const m = createMirror();
  m.take(obj({ type: 'assistant', message: {} }));
  assert.equal((await m.writeTo(path)).offset, 0);
  assert.equal((await readFile(path, 'utf8')).includes('assistant'), true);
});

test('only kept lines are written, and bytes counts what was written', async () => {
  const path = join(await tmp(), 's2.jsonl');
  const m = createMirror();
  m.take(obj({ type: 'system', subtype: 'hook_started' }));
  m.take(obj({ type: 'assistant', message: { content: 'hi' } }));
  const { bytes } = await m.writeTo(path);

  const written = await readFile(path, 'utf8');
  assert.equal(written.includes('hook_started'), false);
  assert.equal(written.includes('assistant'), true);
  assert.equal(bytes, Buffer.byteLength(written));
});

test('take returns the parsed object so the caller need not parse twice', () => {
  const m = createMirror();
  assert.equal(m.take(obj({ type: 'result', subtype: 'success', result: 'ok' })).result, 'ok');
});

test('an unparsable line is skipped without throwing', () => {
  assert.equal(createMirror().take('{not json'), null);
});

test('a turn that wrote nothing reports zero bytes at the current length', async () => {
  // A run killed before its first kept line. The index entry must say zero
  // rather than inherit the previous turn's length.
  const path = join(await tmp(), 's5.jsonl');
  await writeFile(path, '{"type":"result"}\n');
  const m = createMirror();
  m.take(obj({ type: 'system', subtype: 'hook_started' }));
  assert.deepEqual(await m.writeTo(path), { offset: 18, bytes: 0 });
});

test('a second turn appends after the first', async () => {
  const path = join(await tmp(), 's6.jsonl');
  const first = createMirror();
  first.take(obj({ type: 'assistant', message: {} }));
  const a = await first.writeTo(path);

  const second = createMirror();
  second.take(obj({ type: 'assistant', message: {} }));
  const b = await second.writeTo(path);
  assert.equal(b.offset, a.bytes);
  assert.equal(a.bytes + b.bytes, Buffer.byteLength(await readFile(path, 'utf8')));
});

test('a transcript is named by its session id under the workspace', () => {
  assert.equal(transcriptPathFor('/ws', 'abc'), '/ws/transcripts/abc.jsonl');
});

test('a record we write ourselves is held to the same allowlist', async () => {
  const path = join(await tmp(), 'r.jsonl');
  const m = createMirror();
  m.record({ type: 'user', message: { content: 'do the thing' } });
  m.record({ type: 'system', subtype: 'hook_started' });
  await m.writeTo(path);
  const written = await readFile(path, 'utf8');
  assert.equal(written.includes('do the thing'), true);
  assert.equal(written.includes('hook_started'), false);
});
