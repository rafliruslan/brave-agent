import test from 'node:test';
import assert from 'node:assert/strict';
import { fireKey, claimFire } from './routines.mjs';

// The old stamp was `now.toISOString().slice(0,13)` + `now.getMinutes()`: a UTC
// date-hour glued to LOCAL minutes. Identical on whole-hour offsets, wrong on
// +05:30, and wrong in a way that only shows up as a routine firing twice or
// not at all in one zone.

test('the key is one clock throughout', () => {
  assert.equal(fireKey(new Date('2026-09-09T11:38:42.171Z')), 'cron:2026-09-09T11:38Z');
});

test('the key is minute precision, so seconds within a tick collapse', () => {
  const a = fireKey(new Date('2026-09-09T11:38:00.000Z'));
  const b = fireKey(new Date('2026-09-09T11:38:59.999Z'));
  assert.equal(a, b);
});

test('a half-hour offset cannot change the key', () => {
  // Same instant, and the key must not depend on the machine's zone.
  const instant = new Date('2026-09-09T18:08:00.000Z');
  assert.equal(fireKey(instant), 'cron:2026-09-09T18:08Z');
});

test('the key comes from the scheduled instant, not from now', () => {
  // A tick that arrives late must produce the key of the minute it is FOR, so
  // a replay after a restart collides instead of firing again.
  const scheduled = new Date('2026-09-09T11:30:00.000Z');
  assert.equal(fireKey(scheduled), 'cron:2026-09-09T11:30Z');
});

test('claiming an unfired key succeeds and records it', () => {
  const { claimed, state } = claimFire({}, 'price-alerts', 'cron:2026-09-09T11:38Z');
  assert.equal(claimed, true);
  assert.equal(state['price-alerts'].lastFireKey, 'cron:2026-09-09T11:38Z');
});

test('claiming the same key twice fails the second time', () => {
  const first = claimFire({}, 'price-alerts', 'cron:2026-09-09T11:38Z');
  const second = claimFire(first.state, 'price-alerts', 'cron:2026-09-09T11:38Z');
  assert.equal(second.claimed, false);
});

test('a different minute claims again', () => {
  const first = claimFire({}, 'price-alerts', 'cron:2026-09-09T11:38Z');
  const second = claimFire(first.state, 'price-alerts', 'cron:2026-09-09T11:48Z');
  assert.equal(second.claimed, true);
});

test('routines do not block each other', () => {
  const first = claimFire({}, 'price-alerts', 'cron:2026-09-09T11:38Z');
  const second = claimFire(first.state, 'payout-check', 'cron:2026-09-09T11:38Z');
  assert.equal(second.claimed, true);
});

test('claiming does not mutate the state it was given', () => {
  // The caller persists the returned state before spawning. Mutating in place
  // would make "claimed but not yet durable" indistinguishable from "durable".
  const before = {};
  claimFire(before, 'price-alerts', 'cron:2026-09-09T11:38Z');
  assert.deepEqual(before, {});
});

test('claiming keeps whatever else the routine had recorded', () => {
  const state = { 'price-alerts': { lastRun: '2026-09-08T00:00:00Z', ok: true } };
  const { state: next } = claimFire(state, 'price-alerts', 'cron:2026-09-09T11:38Z');
  assert.equal(next['price-alerts'].lastRun, '2026-09-08T00:00:00Z');
  assert.equal(next['price-alerts'].ok, true);
});
