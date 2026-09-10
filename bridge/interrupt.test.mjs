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
  assert.deepEqual(parseInterrupt('<@U02EXAMPLEB> !stop'), { stop: true, prompt: null });
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

// --- trailing noise ---------------------------------------------------------
//
// Slack appends an attribution line to messages sent through some apps, so
// "!stop" arrives as "!stop\n*Sent using* <@U0A8...>". That fell through to
// steer, killed the run, and immediately started another one with "stop" as
// the task. Observed live.

test('a stop survives a trailing attribution line', () => {
  assert.deepEqual(parseInterrupt('!stop\n*Sent using* <@U03EXAMPLEC>'), {
    stop: true,
    prompt: null,
  });
});

test('a bare ! survives a trailing attribution line', () => {
  assert.deepEqual(parseInterrupt('!\n*Sent using* <@U03EXAMPLEC>'), { stop: true, prompt: null });
});

test('a multi-line instruction is still steered, in full', () => {
  // The fix must not turn every multi-line interrupt into a stop.
  assert.deepEqual(parseInterrupt('!check the inbox\nthen report back'), {
    stop: false,
    prompt: 'check the inbox\nthen report back',
  });
});

test('a stop survives the attribution appended INLINE', () => {
  // The actual observed form, logged off a live event. It is appended with a
  // space, not a newline, so a first-line rule cannot see it - which is why
  // the first fix for this did not work and the second test was needed.
  assert.deepEqual(parseInterrupt('!stop *Sent using* <@U03EXAMPLEC>'), {
    stop: true,
    prompt: null,
  });
});

test('a bare ! survives the inline attribution', () => {
  assert.deepEqual(parseInterrupt('! *Sent using* <@U03EXAMPLEC>'), { stop: true, prompt: null });
});

test('a steered instruction loses the attribution but keeps the instruction', () => {
  assert.deepEqual(parseInterrupt('!check the inbox *Sent using* <@U03EXAMPLEC>'), {
    stop: false,
    prompt: 'check the inbox',
  });
});

test('an instruction that merely mentions sending is untouched', () => {
  // The strip is anchored to the end, so ordinary prose survives.
  assert.deepEqual(parseInterrupt('!tell me what you are sending'), {
    stop: false,
    prompt: 'tell me what you are sending',
  });
});
