/**
 * Threads the agent follows without being tagged again.
 *
 * A mention is a fine way to start, and a poor way to continue. Answering
 * "and the other one?" should not need an @, but a bot only sees mentions
 * unless it subscribes to `message.*` events, at which point it sees every
 * message in every channel it is in. That is the whole problem: the firehose
 * is easy to receive and expensive to act on.
 *
 * So membership is explicit. A thread is followed after the agent has replied
 * in it, and only messages in a followed thread are considered. Everything
 * else is dropped in `shouldHandle` before any work happens.
 *
 * Subscriptions expire. A thread nobody has touched for a day is finished, and
 * keeping it live means an offhand comment weeks later wakes the agent.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_SUBS_PATH = join(
  homedir(), '.local', 'state', 'brave-agent', 'subscriptions.json',
);

export function createSubscriptionStore({
  path = DEFAULT_SUBS_PATH,
  now = () => Date.now(),
  ttlMs = DAY_MS,
} = {}) {
  let cache = null;

  async function load() {
    if (cache) return cache;
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8'));
      cache = parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      cache = {};
    }
    return cache;
  }

  async function persist(data) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(data, null, 2));
  }

  return {
    /** Follow a thread, or refresh one already followed. */
    async subscribe(threadTs, meta = {}) {
      const data = await load();
      data[threadTs] = { ...meta, at: now() };
      await persist(data);
    },

    async unsubscribe(threadTs) {
      const data = await load();
      if (!(threadTs in data)) return false;
      delete data[threadTs];
      await persist(data);
      return true;
    },

    /** Followed and not expired. Expiry is checked on read, not on a timer. */
    async isSubscribed(threadTs) {
      const data = await load();
      const entry = data[threadTs];
      if (!entry) return false;
      return now() - entry.at <= ttlMs;
    },

    async prune() {
      const data = await load();
      const cutoff = now() - ttlMs;
      let removed = 0;
      for (const [key, entry] of Object.entries(data)) {
        if (!entry || entry.at < cutoff) {
          delete data[key];
          removed += 1;
        }
      }
      if (removed > 0) await persist(data);
      return removed;
    },

    async count() {
      return Object.keys(await load()).length;
    },
  };
}

/**
 * Decide whether a raw `message.*` event is work for us.
 *
 * Ordered cheapest first, because this runs on every message in every channel
 * the bot is in, and almost all of them are none of its business.
 *
 * The mention case is deliberately excluded: Slack delivers a mention as BOTH
 * `app_mention` and `message.*`, so handling it here as well would run the
 * whole task twice and post two answers.
 */
export function shouldHandle(event, { botUserId, allowedUser, subscribed } = {}) {
  if (!event) return false;

  // Our own messages, and anything else posted by an app.
  if (event.bot_id) return false;
  if (botUserId && event.user === botUserId) return false;

  // Edits, deletions, joins, topic changes. Only plain messages and files.
  if (event.subtype && event.subtype !== 'file_share') return false;

  // One person may drive the agent. Same boundary as a mention.
  if (allowedUser && event.user !== allowedUser) return false;

  // Thread replies only. A top-level message is a new conversation, and
  // starting one still requires a mention.
  if (!event.thread_ts || event.thread_ts === event.ts) return false;

  // app_mention already covers this one.
  if (botUserId && typeof event.text === 'string' && event.text.includes(`<@${botUserId}>`)) {
    return false;
  }

  return Boolean(subscribed);
}

/** Words that end a subscription, so leaving a thread needs no admin UI. */
const STOP = /^\s*(stop|quiet|shush|stand down|that is all|thats all|nevermind|never mind)\s*[.!]?\s*$/i;

export function isStopPhrase(text) {
  return STOP.test(String(text ?? ''));
}
