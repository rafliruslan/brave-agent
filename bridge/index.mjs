/**
 * the agent's Slack bridge, Linux edition.
 *
 * Written fresh against `runner.mjs`, as the handoff instructed. Every other
 * module in this directory came from the Mac and is unchanged except for two
 * XDG path swaps and the session-id source.
 *
 * The one operational rule that makes this safe (README section 2): Socket Mode
 * allows multiple concurrent connections and Slack delivers `app_mention` to
 * ALL of them. If the Mac bridge is ever re-enabled while this runs, every
 * mention is answered twice by two different agents in the same thread. The Mac
 * side is stopped AND `launchctl disable`d; disable is the half that matters,
 * because a LaunchAgent otherwise returns at next login.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import bolt from '@slack/bolt';

import { PERSONA } from './persona.mjs';
import { createSessionStore, DEFAULT_STATE_PATH } from './sessions.mjs';
import { createPendingStore, DEFAULT_PENDING_PATH } from './pending.mjs';
import { createQueue } from './queue.mjs';
import { fetchThreadContext, composeTask, locationNote } from './thread.mjs';
import { parseMention, formatResult } from './text.mjs';
import { buildBlocks } from './blocks.mjs';
import { runAgent } from './runner.mjs';
import { pickModel, stripDirective } from './router.mjs';

const { App } = bolt;

const ENV_PATH = process.env.AGENT_ENV_PATH || join(homedir(), '.config', 'brave-agent', 'env');
const WORKSPACE = process.env.AGENT_WORKSPACE || join(homedir(), '.local', 'share', 'brave-agent', 'workspace');
const MCP_CONFIG = process.env.AGENT_MCP_CONFIG || join(homedir(), '.config', 'brave-agent', 'mcp.json');

/**
 * Tools the agent may use without being asked.
 *
 * `mcp__brave` allows the whole Playwright MCP surface: the accessibility
 * snapshot with refs, navigation, clicking, typing, screenshots. That is the
 * standing order from aside-MEMORY.md ("no confirmations, no draft previews")
 * applied to the browser layer.
 *
 * What still bounds her is the workspace cwd and the denied `Task` tool, not a
 * per-action prompt: there is no human at a headless run to answer one, and a
 * denial here surfaces as an honest refusal in Slack rather than a stall.
 */
const ALLOWED_TOOLS = [
  'mcp__brave',
  // chrome-devtools-mcp, on the same CDP endpoint as `brave`. Added because
  // Playwright's click has an actionability gate that Google Calendar never
  // satisfies: the ref resolves but "stable" never passes on its animating
  // containers. Measured 2026-08-25, same button, same page: playwright
  // `browser_click` failed three times; devtools click returned "Successfully
  // clicked on the element" on the first attempt.
  'mcp__devtools',
  'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'WebFetch', 'WebSearch',
];

/** Threads run one at a time; this caps how many threads run together. */
const DEFAULT_CONCURRENCY = 3;

/**
 * Channels the agent will answer in. `*` means any channel she has been invited
 * to, which is already gated by Slack: she only receives `app_mention` from
 * channels someone added her to. A comma-separated list narrows it further.
 */
function channelAllowed(allowed, channel) {
  if (!allowed || allowed === '*') return true;
  return allowed
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
    .includes(channel);
}

const PLACEHOLDER_TEXT = '⏳ running…';

/**
 * Read the KEY=VALUE env file. Kept out of the repo and out of any transcript;
 * mode 600. ALLOWED_USER is the entire security boundary for this bot.
 */
async function loadEnv(path = ENV_PATH) {
  const raw = await readFile(path, 'utf8');
  const out = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

/**
 * Adapt a runner result to the shape `formatResult` expects.
 *
 * text.mjs is ported verbatim from the Mac, where the runner returned
 * `{ ok, output, error, timedOut }`. Bending the caller keeps that module
 * byte-identical, which matters: it encodes five Slack rendering faults that
 * were each found in a live channel rather than by any test.
 */
function toLegacyResult(r) {
  return {
    ok: r.ok,
    output: r.text,
    error: r.ok ? '' : r.text,
    timedOut: r.timedOut,
  };
}

async function main() {
  const env = await loadEnv();
  const { SLACK_BOT_TOKEN, SLACK_APP_TOKEN, ALLOWED_USER, ALLOWED_CHANNEL, MAX_CONCURRENT } = env;

  const concurrency = Number.parseInt(MAX_CONCURRENT, 10) > 0
    ? Number.parseInt(MAX_CONCURRENT, 10)
    : DEFAULT_CONCURRENCY;

  if (!SLACK_BOT_TOKEN || !SLACK_APP_TOKEN) {
    throw new Error(`SLACK_BOT_TOKEN and SLACK_APP_TOKEN must be set in ${ENV_PATH}`);
  }
  if (!ALLOWED_USER) {
    throw new Error(`ALLOWED_USER must be set in ${ENV_PATH}; it is the only access control`);
  }

  const app = new App({
    token: SLACK_BOT_TOKEN,
    appToken: SLACK_APP_TOKEN,
    socketMode: true,
  });

  const sessions = createSessionStore({ path: DEFAULT_STATE_PATH });
  const pendingStore = createPendingStore({ path: DEFAULT_PENDING_PATH });
  const queue = createQueue({ concurrency });

  const auth = await app.client.auth.test({ token: SLACK_BOT_TOKEN });
  const botUserId = auth.user_id;

  // Anything still recorded belongs to a process that is already gone, so it
  // will never be edited by its owner. Found on the Mac after 29 restarts: a
  // placeholder from 12:38 still said "running…" at 21:41.
  for (const orphan of await pendingStore.takeAll()) {
    try {
      await app.client.chat.update({
        token: SLACK_BOT_TOKEN,
        channel: orphan.channel,
        ts: orphan.ts,
        text: '❌ The bridge restarted while this was running. Ask me again, Captain. 💗',
      });
    } catch {
      // The message may have been deleted; an orphan is not worth crashing for.
    }
  }

  const pruned = await sessions.prune();
  if (pruned) console.log(`[agent] retired ${pruned} stale session(s)`);

  app.event('app_mention', async ({ event, client }) => {
    // The whole access control. Anyone else in the channel is ignored in
    // silence: replying would tell an unauthorised user the bot is listening.
    if (event.user !== ALLOWED_USER) {
      console.log(`[agent] ignored mention from ${event.user}`);
      return;
    }
    if (!channelAllowed(ALLOWED_CHANNEL, event.channel)) {
      console.log(`[agent] ignored mention in ${event.channel}`);
      return;
    }

    const channel = event.channel;
    const threadTs = event.thread_ts || event.ts;
    const mentioned = parseMention(event.text, botUserId);
    // Route on what he typed, then strip the routing marker so the model is
    // never handed "deep:" as part of the task.
    const route = pickModel(mentioned);
    const prompt = stripDirective(mentioned);

    await queue.add(threadTs, async () => {
      let placeholderTs = null;

      try {
        const posted = await client.chat.postMessage({
          channel,
          thread_ts: threadTs,
          text: PLACEHOLDER_TEXT,
        });
        placeholderTs = posted.ts;
        // Recorded BEFORE the run, cleared after: that ordering is what makes
        // "still present at startup" mean "orphaned" and nothing else.
        await pendingStore.add(channel, placeholderTs, { threadTs });
        console.log(`[agent] ${threadTs} -> ${route.model}/${route.effort} (${route.reason})`);

        const threadContext = await fetchThreadContext(client, {
          channel,
          threadTs,
          botUserId,
          skipTs: event.ts,
        });

        const existing = await sessions.get(threadTs);
        const sessionId = existing || (await sessions.idFor(threadTs));
        const isNew = !existing;

        const task = composeTask(prompt, threadContext);
        const note = locationNote({ channel, threadTs });
        // Persona on a thread's first turn only. After that it lives in the
        // session history, and repeating it makes her restate herself.
        const full = [isNew ? PERSONA : '', task, '\n\n---\n\n', note]
          .filter(Boolean)
          .join('');

        let result = await runAgent({
          prompt: full,
          sessionId,
          isNew,
          cwd: WORKSPACE,
          model: route.model,
          effort: route.effort,
          mcpConfig: MCP_CONFIG,
          allowedTools: ALLOWED_TOOLS,
        });

        // A resumed session that is gone never recovers. Release the thread and
        // silently retry in a fresh one rather than showing the user an error.
        if (!result.ok && result.deadSession && !isNew) {
          console.log(`[agent] session ${sessionId} is gone; restarting thread ${threadTs}`);
          await sessions.forget(threadTs);
          const freshId = await sessions.idFor(threadTs);
          result = await runAgent({
            prompt: PERSONA + task + '\n\n---\n\n' + note,
            sessionId: freshId,
            isNew: true,
            cwd: WORKSPACE,
            model: route.model,
            effort: route.effort,
            mcpConfig: MCP_CONFIG,
            allowedTools: ALLOWED_TOOLS,
          });
          if (result.ok) await sessions.set(threadTs, freshId);
        } else if (result.ok) {
          await sessions.set(threadTs, result.sessionId || sessionId);
        }

        if (result.denials?.length) {
          console.log(`[agent] ${result.denials.length} permission denial(s) in ${threadTs}`);
        }

        const body = formatResult(toLegacyResult(result));
        const blocks = buildBlocks(body);

        await client.chat.update({
          channel,
          ts: placeholderTs,
          text: body,
          ...(blocks ? { blocks } : {}),
        });
      } catch (err) {
        console.error('[agent] run failed:', err);
        if (placeholderTs) {
          try {
            await client.chat.update({
              channel,
              ts: placeholderTs,
              text: `❌ bridge error: ${err.message}`,
            });
          } catch {
            // Nothing further to do; the catch below clears the record.
          }
        }
      } finally {
        if (placeholderTs) await pendingStore.remove(channel, placeholderTs);
      }
    });
  });

  await app.start();
  console.log(`[agent] connected as ${auth.user} (${botUserId}) in ${auth.team}`);
  console.log(`[agent] workspace ${WORKSPACE}, concurrency ${concurrency}, channels ${ALLOWED_CHANNEL || '*'}`);
}

main().catch((err) => {
  console.error('[agent] fatal:', err.message);
  process.exit(1);
});
