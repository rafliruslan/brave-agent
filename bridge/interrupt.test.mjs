import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInterrupt } from './interrupt.mjs';

test('a plain message is not an interrupt', () => {
  assert.equal(parseInterrupt('check the inbox'), null);
});

test('a bare ! stops', () => {
  assert.deepEqual(parseInterrupt('!'), { stop: true, prompt: null });
});

test('!stop stops', () => {
  assert.deepEqual(parseInterrupt('!stop'), { stop: true, prompt: null });
  assert.deepEqual(parseInterrupt('  !STOP  '), { stop: true, prompt: null });
  assert.deepEqual(parseInterrupt('! stop'), { stop: true, prompt: null });
});

test('! followed by an instruction steers', () => {
  assert.deepEqual(parseInterrupt('!check the inbox instead'), {
    stop: false,
    prompt: 'check the inbox instead',
  });
});

test('the space after ! is optional', () => {
  assert.deepEqual(parseInterrupt('! check the inbox'), { stop: false, prompt: 'check the inbox' });
});

test('a ! in the middle of a sentence is not an interrupt', () => {
  // Otherwise "that worked!" would kill a run.
  assert.equal(parseInterrupt('that worked! now do the next one'), null);
});

test('a leading mention is stripped before looking', () => {
  // app_mention text arrives with the bot id in front of it.
  assert.deepEqual(parseInterrupt('<@U0BPLEDEF40> !stop'), { stop: true, prompt: null });
});

test('an empty or missing message is not an interrupt', () => {
  assert.equal(parseInterrupt(''), null);
  assert.equal(parseInterrupt(null), null);
  assert.equal(parseInterrupt(undefined), null);
});

test('!! is a stop, not an instruction called "!"', () => {
  assert.deepEqual(parseInterrupt('!!'), { stop: true, prompt: null });
});

test('"stop" without the marker is an ordinary message', () => {
  // "stop the deploy" is a task, not a control command. The marker is what
  // makes the difference, so a real instruction is never eaten.
  assert.equal(parseInterrupt('stop the deploy'), null);
});
