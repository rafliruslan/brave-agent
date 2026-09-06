import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRunRegistry } from './runs.mjs';

/** A child process, as far as this module cares: kill it, and it exits. */
function fakeChild() {
  const c = new EventEmitter();
  c.killed = false;
  c.kill = (sig) => {
    c.killed = true;
    c.signal = sig;
    queueMicrotask(() => c.emit('exit', null, sig));
    return true;
  };
  return c;
}

test('a tracked run is running', () => {
  const runs = createRunRegistry();
  runs.track('t1', fakeChild());
  assert.equal(runs.isRunning('t1'), true);
  assert.equal(runs.isRunning('t2'), false);
});

test('stopping kills the child and reports it', () => {
  const runs = createRunRegistry();
  const c = fakeChild();
  runs.track('t1', c);
  assert.equal(runs.stop('t1'), true);
  assert.equal(c.killed, true);
});

test('stopping a thread with no run is a no-op, not an error', () => {
  const runs = createRunRegistry();
  assert.equal(runs.stop('nothing'), false);
});

test('a run that exits on its own stops being tracked', async () => {
  // Otherwise the registry grows forever and every finished thread looks busy,
  // which would make a later interrupt kill nothing and report success.
  const runs = createRunRegistry();
  const c = fakeChild();
  runs.track('t1', c);
  c.emit('exit', 0, null);
  await new Promise((r) => setImmediate(r));
  assert.equal(runs.isRunning('t1'), false);
});

test('a killed run stops being tracked once it exits', async () => {
  const runs = createRunRegistry();
  const c = fakeChild();
  runs.track('t1', c);
  runs.stop('t1');
  await new Promise((r) => setImmediate(r));
  assert.equal(runs.isRunning('t1'), false);
});

test('tracking a second run for one thread replaces the first', async () => {
  // The queue serialises per thread, so two live children on one thread would
  // mean two answers in one Slack thread, which is the failure the lock and
  // the queue both exist to prevent. Kill the old one rather than lose it.
  const runs = createRunRegistry();
  const first = fakeChild();
  const second = fakeChild();
  runs.track('t1', first);
  runs.track('t1', second);
  assert.equal(first.killed, true);
  assert.equal(runs.isRunning('t1'), true);
});

test('an already-exited child does not linger under a new key', async () => {
  const runs = createRunRegistry();
  const c = fakeChild();
  runs.track('t1', c);
  c.emit('exit', 0, null);
  await new Promise((r) => setImmediate(r));
  runs.track('t2', fakeChild());
  assert.equal(runs.size(), 1);
});

test('a kill that throws is reported as not stopped rather than crashing', () => {
  const runs = createRunRegistry();
  const c = new EventEmitter();
  c.kill = () => { throw new Error('ESRCH'); };
  runs.track('t1', c);
  assert.equal(runs.stop('t1'), false);
});

// --- what started the run ---------------------------------------------------
//
// Stopping has to undo the progress signals, and those are keyed on the message
// that TRIGGERED the run, not on the message asking to stop. Without carrying
// it, a stop leaves a 👀 on the original message and a pending entry that the
// next boot sweeps up as an orphan and apologises for.

test('the registry carries what started the run', () => {
  const runs = createRunRegistry();
  runs.track('t1', fakeChild(), { channel: 'C1', ts: '111.1' });
  assert.deepEqual(runs.startedBy('t1'), { channel: 'C1', ts: '111.1' });
});

test('stopping still reports what it stopped', () => {
  const runs = createRunRegistry();
  runs.track('t1', fakeChild(), { channel: 'C1', ts: '111.1' });
  const meta = runs.startedBy('t1');
  assert.equal(runs.stop('t1'), true);
  assert.deepEqual(meta, { channel: 'C1', ts: '111.1' });
});

test('a thread with no run has nothing that started it', () => {
  assert.equal(createRunRegistry().startedBy('nope'), null);
});

test('tracking without metadata still works', () => {
  const runs = createRunRegistry();
  runs.track('t1', fakeChild());
  assert.equal(runs.startedBy('t1'), null);
  assert.equal(runs.isRunning('t1'), true);
});
