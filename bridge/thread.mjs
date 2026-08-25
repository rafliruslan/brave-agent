/**
 * Reading the Slack thread a mention arrived in.
 *
 * The the agent session remembers what the agent was told, but not what was said in
 * the thread without mentioning her. Typing a message, then remembering to
 * @mention her afterwards, used to lose that first message entirely. Pulling
 * the thread transcript closes that gap.
 */

/** Messages fetched per thread. Enough for real context, bounded for tokens. */
export const THREAD_LIMIT = 30;

/** Per-message character cap, so one pasted wall of text cannot dominate. */
export const MESSAGE_CAP = 600;

/**
 * Placeholders the bridge posts before a run finishes. Not conversation.
 *
 * Slack stores emoji as shortcodes, so a message posted as "⏳ running…" reads
 * back as ":hourglass_flowing_sand: running…". Matching only the literal
 * character silently let every placeholder through into her thread context.
 */
const PLACEHOLDER =
  /^\s*(⏳|:hourglass_flowing_sand:|❌|:x:)\s*(running|queued|bridge error)/i;

/**
 * Render fetched Slack messages as a transcript.
 *
 * @param {Array} messages   raw `conversations.replies` messages, oldest first
 * @param {string} botUserId so the bot's own turns can be labelled
 * @param {string} skipTs    ts of the triggering mention, which becomes the prompt
 */
export function formatThread(messages, botUserId, skipTs) {
  const lines = [];

  for (const msg of messages || []) {
    if (!msg || msg.ts === skipTs) continue;

    const text = String(msg.text || '').trim();
    if (!text) continue;
    if (PLACEHOLDER.test(text)) continue;

    const isBot = msg.bot_id || msg.user === botUserId;
    const speaker = isBot ? 'the agent' : 'the user';

    // Mentions render as <@U123>; the raw id adds nothing for a reader.
    const cleaned = text.replace(/<@[A-Z0-9]+>/g, '').replace(/[ \t]+/g, ' ').trim();
    if (!cleaned) continue;

    const capped =
      cleaned.length > MESSAGE_CAP ? `${cleaned.slice(0, MESSAGE_CAP)}… (truncated)` : cleaned;

    lines.push(`[${speaker}] ${capped}`);
  }

  return lines.join('\n');
}

/**
 * Fetch and format the thread a mention arrived in. Returns '' when there is
 * no thread, nothing worth quoting, or Slack refuses (a missing history scope
 * should degrade context, never break the run).
 */
export async function fetchThreadContext(client, { channel, threadTs, botUserId, skipTs }) {
  if (!threadTs) return '';
  try {
    const res = await client.conversations.replies({
      channel,
      ts: threadTs,
      limit: THREAD_LIMIT,
    });
    return formatThread(res.messages, botUserId, skipTs);
  } catch {
    return '';
  }
}

/**
 * Assemble what the agent is actually asked to do.
 *
 * A bare @mention is not an error. It means "look at what we were just talking
 * about and respond", which is exactly how someone uses a colleague they forgot
 * to tag in the previous message.
 */
/**
 * Where this reply is going, so she can attach files to it.
 *
 * The bridge posts her text for her, which means she never learns the channel
 * or thread. Observed: asked to attach a screenshot, she took it, wrote it to
 * disk, then had nowhere to send it and said nothing. This closes that gap.
 */
export function locationNote({ channel, threadTs }) {
  if (!channel || !threadTs) return '';
  return `You are replying in Slack channel \`${channel}\`, thread \`${threadTs}\`. Your text reply is posted for you.

Say it once in this thread. Your reply already appears here, so do not also post the same content as him into this same thread: he ends up reading it twice, once from you and once from himself.
- If this thread only needs a report to him, just reply. Post nothing yourself.
- If teammates in this thread need a message in his voice, post that one as him, and then keep your reply to a single line saying you posted it. Do not restate its contents.
- Posting as him into a DIFFERENT channel or thread is fine and is not a repeat.

To attach a file or screenshot, upload it yourself with \`filesUploadV2({ channel_id: '${channel}', thread_ts: '${threadTs}', file_uploads: [...] })\`.
If you are asked for something you cannot deliver here, say so plainly rather than leaving it out.`;
}

export function composeTask(prompt, threadContext) {
  const hasPrompt = Boolean(prompt && prompt.trim());
  const hasContext = Boolean(threadContext && threadContext.trim());

  if (hasPrompt && !hasContext) return prompt;

  if (hasPrompt && hasContext) {
    return `Slack thread so far, for context. You may already know some of this:

${threadContext}

---

the user now says: ${prompt}`;
  }

  if (hasContext) {
    return `Slack thread so far:

${threadContext}

---

the user mentioned you without adding a message. Read the thread above and respond to what he is asking or needs. If nothing is being asked, say something to him and ask what he needs.`;
  }

  return 'the user mentioned you without saying anything else. Greet him and ask what he needs.';
}
