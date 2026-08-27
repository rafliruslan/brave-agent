/**
 * Show progress on the user's own message, rather than only in a reply.
 *
 * The placeholder reply says "running" and later becomes the answer, which is
 * necessary but invisible until you open the thread. A reaction on the message
 * you just sent is visible from the channel list, so a busy channel still shows
 * at a glance what was picked up, what finished, and what failed.
 *
 * Slack has no typing indicator for ordinary bots. The nearest real thing is
 * `assistant.threads.setStatus`, which needs the app configured as an AI
 * assistant and only applies inside assistant threads. It is attempted here and
 * ignored when unavailable, so enabling the Agents feature later lights it up
 * with no code change.
 *
 * Every call is best effort. A missing `reactions:write` scope must degrade to
 * a bridge without reactions, never to a bridge that stops answering.
 */

/** Picked up and working. */
export const WORKING = 'eyes';
/** Finished, answer posted. */
export const DONE = 'white_check_mark';
/** Failed or timed out. */
export const FAILED = 'x';

/** Slack shortcode names, no colons. Kept together so tests can assert them. */
export const ALL = [WORKING, DONE, FAILED];

/**
 * Add a reaction, swallowing the errors that are not worth failing a run over.
 * `already_reacted` is success from our point of view.
 */
export async function react(client, { channel, ts, name, logger } = {}) {
  if (!client || !channel || !ts || !name) return false;
  try {
    await client.reactions.add({ channel, timestamp: ts, name });
    return true;
  } catch (err) {
    const code = err?.data?.error || err?.message || 'unknown';
    if (code === 'already_reacted') return true;
    // missing_scope is the expected state until reactions:write is granted.
    if (code !== 'missing_scope') logger?.warn?.(`[status] reaction ${name} failed: ${code}`);
    return false;
  }
}

/** Remove one of ours. `no_reaction` means it was never there, which is fine. */
export async function unreact(client, { channel, ts, name, logger } = {}) {
  if (!client || !channel || !ts || !name) return false;
  try {
    await client.reactions.remove({ channel, timestamp: ts, name });
    return true;
  } catch (err) {
    const code = err?.data?.error || err?.message || 'unknown';
    if (code === 'no_reaction' || code === 'missing_scope') return false;
    logger?.warn?.(`[status] unreact ${name} failed: ${code}`);
    return false;
  }
}

/**
 * Move from the working marker to a final one, in that order: the old marker
 * goes first so the message is never briefly showing both.
 */
export async function settle(client, { channel, ts, ok, logger } = {}) {
  await unreact(client, { channel, ts, name: WORKING, logger });
  return react(client, { channel, ts, name: ok ? DONE : FAILED, logger });
}

/**
 * Assistant-thread status line, the closest Slack has to "is typing".
 * Silently does nothing unless the app is an AI assistant.
 */
export async function setStatus(client, { channel, threadTs, status, logger } = {}) {
  if (!client?.assistant?.threads?.setStatus || !channel || !threadTs) return false;
  try {
    await client.assistant.threads.setStatus({
      channel_id: channel,
      thread_ts: threadTs,
      status: status || '',
    });
    return true;
  } catch (err) {
    const code = err?.data?.error || err?.message || 'unknown';
    // Expected whenever this is not an assistant thread. Not worth a log line.
    const expected = ['missing_scope', 'not_allowed_token_type', 'invalid_thread', 'channel_not_found'];
    if (!expected.includes(code)) logger?.warn?.(`[status] setStatus failed: ${code}`);
    return false;
  }
}
