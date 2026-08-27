import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSubscriptionStore, shouldHandle, isStopPhrase } from './subscriptions.mjs';

const BOT = 'UBOT1';
const RAFLI = 'URAFLI';
const base = (over = {}) => ({ user: RAFLI, thread_ts: '1.0', ts: '1.5', text: 'and the other one?', ...over });

async function withStore(fn, opts = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'brave-subs-'));
  try {
    await fn(createSubscriptionStore({ path: join(dir, 'nested', 'subs.json'), ...opts }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('a followed thread is handled', () => {
  assert.equal(shouldHandle(base(), { botUserId: BOT, allowedUser: RAFLI, subscribed: true }), true);
});

test('an unfollowed thread is ignored', () => {
  assert.equal(shouldHandle(base(), { botUserId: BOT, allowedUser: RAFLI, subscribed: false }), false);
});

// Slack sends a mention as both app_mention and message.*, so handling it here
// too would run the task twice and post two answers.
test('a message containing a mention is left to app_mention', () => {
  const e = base({ text: `<@${BOT}> do it again` });
  assert.equal(shouldHandle(e, { botUserId: BOT, allowedUser: RAFLI, subscribed: true }), false);
});

test('the agent never answers itself', () => {
  assert.equal(shouldHandle(base({ user: BOT }), { botUserId: BOT, allowedUser: RAFLI, subscribed: true }), false);
  assert.equal(shouldHandle(base({ bot_id: 'B1' }), { botUserId: BOT, allowedUser: RAFLI, subscribed: true }), false);
});

test('anyone other than the allowed user is ignored', () => {
  assert.equal(shouldHandle(base({ user: 'USOMEONE' }), { botUserId: BOT, allowedUser: RAFLI, subscribed: true }), false);
});

// Edits and joins would otherwise re-run a task that already ran.
test('edits, deletions and joins are ignored', () => {
  for (const subtype of ['message_changed', 'message_deleted', 'channel_join', 'thread_broadcast']) {
    assert.equal(shouldHandle(base({ subtype }), { botUserId: BOT, allowedUser: RAFLI, subscribed: true }), false, subtype);
  }
});

test('a file share still counts as a message', () => {
  assert.equal(shouldHandle(base({ subtype: 'file_share' }), { botUserId: BOT, allowedUser: RAFLI, subscribed: true }), true);
});

// Starting a conversation still requires a mention.
test('a top-level message is never handled', () => {
  assert.equal(shouldHandle(base({ thread_ts: undefined }), { botUserId: BOT, allowedUser: RAFLI, subscribed: true }), false);
  assert.equal(shouldHandle(base({ thread_ts: '1.5', ts: '1.5' }), { botUserId: BOT, allowedUser: RAFLI, subscribed: true }), false);
});

test('a missing event is not handled', () => {
  assert.equal(shouldHandle(null, { botUserId: BOT, subscribed: true }), false);
});

test('stop phrases are recognised, ordinary text is not', () => {
  for (const s of ['stop', 'Stop.', 'quiet', 'stand down', 'that is all', 'never mind']) {
    assert.equal(isStopPhrase(s), true, s);
  }
  for (const s of ['stop the deploy', 'is it quiet today?', '', null]) {
    assert.equal(isStopPhrase(s), false, String(s));
  }
});

test('subscribe then isSubscribed round-trips', async () => {
  await withStore(async (s) => {
    assert.equal(await s.isSubscribed('1.0'), false);
    await s.subscribe('1.0', { channel: 'C1' });
    assert.equal(await s.isSubscribed('1.0'), true);
    assert.equal(await s.count(), 1);
  });
});

test('unsubscribe stops the following', async () => {
  await withStore(async (s) => {
    await s.subscribe('1.0');
    assert.equal(await s.unsubscribe('1.0'), true);
    assert.equal(await s.isSubscribed('1.0'), false);
    assert.equal(await s.unsubscribe('1.0'), false);
  });
});

// Without expiry, an offhand comment weeks later would wake the agent.
test('a subscription expires', async () => {
  let clock = 1000;
  await withStore(async (s) => {
    await s.subscribe('1.0');
    clock += 5000;
    assert.equal(await s.isSubscribed('1.0'), false);
  }, { now: () => clock, ttlMs: 1000 });
});

test('replying again refreshes the expiry', async () => {
  let clock = 1000;
  await withStore(async (s) => {
    await s.subscribe('1.0');
    clock += 900;
    await s.subscribe('1.0');
    clock += 900;
    assert.equal(await s.isSubscribed('1.0'), true);
  }, { now: () => clock, ttlMs: 1000 });
});

test('prune drops only what has expired', async () => {
  let clock = 1000;
  await withStore(async (s) => {
    await s.subscribe('old');
    clock += 5000;
    await s.subscribe('fresh');
    assert.equal(await s.prune(), 1);
    assert.equal(await s.isSubscribed('fresh'), true);
  }, { now: () => clock, ttlMs: 1000 });
});

test('a corrupt store is treated as empty', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'brave-subs-'));
  const path = join(dir, 'subs.json');
  try {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, 'not json');
    const s = createSubscriptionStore({ path });
    assert.equal(await s.isSubscribed('1.0'), false);
    await s.subscribe('1.0');
    assert.equal(await s.isSubscribed('1.0'), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
