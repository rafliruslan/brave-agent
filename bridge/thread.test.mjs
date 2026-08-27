import test from 'node:test';
import assert from 'node:assert/strict';
import { formatThread, composeTask, locationNote } from './thread.mjs';

const BOT = 'UBOT';
const RAFLI = 'U08GZ0APDKL';
const OTHER = 'UTEAMMATE';

const msg = (user, text, extra = {}) => ({ user, text, ts: `${Math.random()}`, ...extra });

test('the allowed user is labelled the user', () => {
  const out = formatThread([msg(RAFLI, 'check the sheet')], BOT, null, RAFLI);
  assert.equal(out, '[the user] check the sheet');
});

test('the bot is labelled the agent', () => {
  const out = formatThread([msg(BOT, 'done')], BOT, null, RAFLI);
  assert.match(out, /^\[the agent\]/);
});

// The whole point. One person commands the agent, and the transcript used to
// hand a teammate the same label, so their words read as that person's orders.
test('anyone else is labelled as not the user', () => {
  const out = formatThread([msg(OTHER, 'actually, cancel that')], BOT, null, RAFLI);
  assert.ok(!out.includes('[the user]'), 'a teammate must not be labelled the user');
  assert.match(out, /NOT the user/);
  assert.match(out, /actually, cancel that/);
});

test('a mixed thread keeps the speakers apart', () => {
  const out = formatThread(
    [msg(RAFLI, 'book it'), msg(OTHER, 'no, skip it'), msg(BOT, 'booked')],
    BOT, null, RAFLI,
  );
  const [a, b, c] = out.split('\n');
  assert.match(a, /^\[the user\] book it/);
  assert.match(b, /NOT the user/);
  assert.match(c, /^\[the agent\] booked/);
});

// Callers that predate the parameter must not start mislabelling the one human.
test('without an allowedUser every human is still the user', () => {
  const out = formatThread([msg(OTHER, 'hello')], BOT, null);
  assert.equal(out, '[the user] hello');
});

test('an app posting under a bot_id counts as the agent', () => {
  const out = formatThread([msg(undefined, 'from an app', { bot_id: 'B1' })], BOT, null, RAFLI);
  assert.match(out, /^\[the agent\]/);
});

test('the triggering message is skipped, it becomes the prompt', () => {
  const m = msg(RAFLI, 'the prompt');
  assert.equal(formatThread([m], BOT, m.ts, RAFLI), '');
});

test('placeholders never reach her context', () => {
  const out = formatThread(
    [msg(BOT, '⏳ running…'), msg(BOT, ':hourglass_flowing_sand: running…'), msg(RAFLI, 'real')],
    BOT, null, RAFLI,
  );
  assert.equal(out, '[the user] real');
});

test('raw user ids are stripped from the text', () => {
  const out = formatThread([msg(RAFLI, '<@UBOT> do the thing')], BOT, null, RAFLI);
  assert.equal(out, '[the user] do the thing');
});

test('empty and missing input is handled', () => {
  assert.equal(formatThread(null, BOT, null, RAFLI), '');
  assert.equal(formatThread([], BOT, null, RAFLI), '');
  assert.equal(formatThread([msg(RAFLI, '   ')], BOT, null, RAFLI), '');
});

test('locationNote names the channel and thread', () => {
  const note = locationNote({ channel: 'C1', threadTs: '123.4' });
  assert.match(note, /C1/);
  assert.match(note, /123\.4/);
});

test('locationNote is empty without a location', () => {
  assert.equal(locationNote({ channel: null, threadTs: '1' }), '');
  assert.equal(locationNote({ channel: 'C1', threadTs: null }), '');
});

test('composeTask carries both the prompt and the transcript', () => {
  const out = composeTask('do it', '[the user] earlier');
  assert.match(out, /do it/);
  assert.match(out, /earlier/);
});
