import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { acquire, release, isAlive, stillHeld, bootTime } from './lock.mjs';

async function withLock(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'brave-lock-'));
  const path = join(dir, 'nested', 'bridge.lock');
  try {
    await fn(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const seed = async (path, held) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(held));
};

test('isAlive is true for this process', () => {
  assert.equal(isAlive(process.pid), true);
});

test('isAlive is false for a pid that does not exist', () => {
  assert.equal(isAlive(2 ** 22), false);
});

// A process owned by another user exists, so the lock must be respected.
test('isAlive treats EPERM as alive', () => {
  const kill = () => { const e = new Error('nope'); e.code = 'EPERM'; throw e; };
  assert.equal(isAlive(1234, kill), true);
});

test('isAlive rejects nonsense pids', () => {
  assert.equal(isAlive(0), false);
  assert.equal(isAlive(-1), false);
  assert.equal(isAlive(undefined), false);
});

test('acquire succeeds when the lock is free', async () => {
  await withLock(async (path) => {
    const res = await acquire({ path, pid: 111 });
    assert.equal(res.ok, true);
    const held = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(held.pid, 111);
    assert.ok(held.host);
    assert.ok(held.since);
  });
});

// The whole point: a second bridge must not connect and answer alongside.
test('acquire refuses when a live process holds it', async () => {
  await withLock(async (path) => {
    await seed(path, { pid: 999, host: 'other' });
    const res = await acquire({ path, pid: 111, alive: () => true });
    assert.equal(res.ok, false);
    assert.equal(res.holder.pid, 999);
    assert.equal(res.holder.host, 'other');
  });
});

// A crash must never wedge the bridge out of its own lock.
test('acquire takes over a lock whose holder is gone', async () => {
  await withLock(async (path) => {
    await seed(path, { pid: 999 });
    const res = await acquire({ path, pid: 111, alive: () => false });
    assert.equal(res.ok, true);
    assert.equal(res.tookOver, true);
  });
});

test('re-acquiring with the same pid is allowed', async () => {
  await withLock(async (path) => {
    await acquire({ path, pid: 111 });
    const res = await acquire({ path, pid: 111, alive: () => true });
    assert.equal(res.ok, true);
    assert.equal(res.tookOver, false);
  });
});

test('a corrupt lock file is treated as free', async () => {
  await withLock(async (path) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, 'not json');
    assert.equal((await acquire({ path, pid: 111 })).ok, true);
  });
});

test('release removes a lock this process holds', async () => {
  await withLock(async (path) => {
    await acquire({ path, pid: 111 });
    assert.equal(await release({ path, pid: 111 }), true);
    assert.equal((await acquire({ path, pid: 222, alive: () => true })).ok, true);
  });
});

// Releasing someone else's lock would reintroduce the double-answer bug.
test('release refuses to remove another process lock', async () => {
  await withLock(async (path) => {
    await seed(path, { pid: 999 });
    assert.equal(await release({ path, pid: 111 }), false);
    const still = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(still.pid, 999);
  });
});

test('release on a missing lock is a no-op', async () => {
  await withLock(async (path) => {
    assert.equal(await release({ path, pid: 111 }), false);
  });
});

// --- boot time -------------------------------------------------------------
//
// A lock records a pid, and isAlive() only proves that SOME process has that
// pid. After a reboot pids are reassigned, so a lock left behind by a killed
// bridge can be "held" by whatever inherits its number. Observed: the bridge
// was down for three days because pid 1018 came back as an Apple XPC service
// 36 seconds after boot, and launchd retried against it every 30 seconds.

test('a lock taken before this boot is stale, whatever the pid says now', () => {
  const boot = Date.parse('2026-09-06T02:10:00Z');
  const held = { pid: 1018, since: '2026-09-03T04:35:34.422Z' };
  assert.equal(stillHeld(held, { pid: 99, alive: () => true, boot }), false);
});

test('a lock taken after boot with a live pid is held', () => {
  const boot = Date.parse('2026-09-06T02:10:00Z');
  const held = { pid: 1018, since: '2026-09-06T03:00:00.000Z' };
  assert.equal(stillHeld(held, { pid: 99, alive: () => true, boot }), true);
});

test('a lock taken after boot with a dead pid is stale', () => {
  const boot = Date.parse('2026-09-06T02:10:00Z');
  const held = { pid: 1018, since: '2026-09-06T03:00:00.000Z' };
  assert.equal(stillHeld(held, { pid: 99, alive: () => false, boot }), false);
});

test('our own lock is never held against us', () => {
  const boot = Date.parse('2026-09-06T02:10:00Z');
  const held = { pid: 42, since: '2026-09-06T03:00:00.000Z' };
  assert.equal(stillHeld(held, { pid: 42, alive: () => true, boot }), false);
});

test('a lock with no usable timestamp falls back to the pid check', () => {
  // Old lock files predate this field. Refusing to start on them would be a
  // worse bug than the one being fixed.
  const boot = Date.parse('2026-09-06T02:10:00Z');
  assert.equal(stillHeld({ pid: 1018 }, { pid: 99, alive: () => true, boot }), true);
  assert.equal(stillHeld({ pid: 1018, since: 'nonsense' }, { pid: 99, alive: () => true, boot }), true);
});

test('a lock taken in the first seconds after boot is NOT called stale', () => {
  // The two mistakes are not symmetric. Wrongly "held" stops the bridge
  // starting, which is loud and safe. Wrongly "stale" starts a second bridge,
  // and then every mention is answered twice by two disagreeing agents. So
  // clock jitter around boot must resolve towards held.
  const boot = Date.parse('2026-09-06T02:10:00Z');
  const held = { pid: 1018, since: '2026-09-06T02:09:58.000Z' }; // 2s before boot
  assert.equal(stillHeld(held, { pid: 99, alive: () => true, boot }), true);
});

test('bootTime is derived from uptime, so it works on Linux and macOS alike', () => {
  const now = Date.parse('2026-09-06T03:00:00Z');
  assert.equal(bootTime(now, () => 3600), Date.parse('2026-09-06T02:00:00Z'));
});

// --- host ------------------------------------------------------------------
//
// The lock records a host and nothing read it. On a shared home directory
// (NFS) a lock written by another machine had its pid checked against the
// local process table, which answers a question about the wrong computer.

test('a lock from another host is held, even when the local pid is dead', () => {
  const boot = Date.parse('2026-09-06T02:10:00Z');
  const held = { pid: 1018, host: 'other-box', since: '2026-09-06T03:00:00.000Z' };
  assert.equal(stillHeld(held, { pid: 99, alive: () => false, boot, host: 'mine' }), true);
});

test('a lock from another host is held, even when it predates OUR boot', () => {
  // Our uptime says nothing about theirs. Neither test applies across machines,
  // so there is nothing to prove it dead with, and refusing to start is the
  // safe half of the asymmetry.
  const boot = Date.parse('2026-09-06T02:10:00Z');
  const held = { pid: 1018, host: 'other-box', since: '2026-09-03T04:35:34.422Z' };
  assert.equal(stillHeld(held, { pid: 99, alive: () => false, boot, host: 'mine' }), true);
});

test('a lock from this host is judged as before', () => {
  const boot = Date.parse('2026-09-06T02:10:00Z');
  const held = { pid: 1018, host: 'mine', since: '2026-09-03T04:35:34.422Z' };
  assert.equal(stillHeld(held, { pid: 99, alive: () => true, boot, host: 'mine' }), false);
});

test('a lock with no host recorded is judged on pid and boot alone', () => {
  const boot = Date.parse('2026-09-06T02:10:00Z');
  const held = { pid: 1018, since: '2026-09-06T03:00:00.000Z' };
  assert.equal(stillHeld(held, { pid: 99, alive: () => true, boot, host: 'mine' }), true);
});

test('our own pid on our own host is still not held against us', () => {
  const boot = Date.parse('2026-09-06T02:10:00Z');
  const held = { pid: 42, host: 'mine', since: '2026-09-06T03:00:00.000Z' };
  assert.equal(stillHeld(held, { pid: 42, alive: () => true, boot, host: 'mine' }), false);
});
