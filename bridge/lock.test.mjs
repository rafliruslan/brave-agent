import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { acquire, release, isAlive } from './lock.mjs';

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
