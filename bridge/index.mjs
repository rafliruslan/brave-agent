/**
 * Slack Socket Mode bridge.
 *
 * Mentions arrive here, become one Claude Code session per thread, and the
 * answer is edited back over the placeholder this posted.
 *
 * The operational rule that makes this safe: Socket Mode permits multiple
 * concurrent connections and Slack delivers `app_mention` to EVERY one of them.
 * Two bridges running against the same app means every mention is answered
 * twice, by two agents that cannot see each other, in the same thread. Run one.
 */

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
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
import { healBrowser } from './browser-health.mjs';
import { pickModel, stripDirective } from './router.mjs';
import { acquire, release } from './lock.mjs';

const { App } = bolt;

const ENV_PATH = process.env.AGENT_ENV_PATH || join(homedir(), '.config', 'brave-agent', 'env');
const WORKSPACE = process.env.AGENT_WORKSPACE || join(homedir(), '.local', 'share', 'brave-agent', 'workspace');
const MCP_CONFIG = process.env.AGENT_MCP_CONFIG || join(homedir(), '.config', 'brave-agent', 'mcp.json');

/**
 * Tools the agent may use without being asked.
 *
 * `mcp__brave` and `mcp__devtools` allow the whole browser surface: the
 * accessibility snapshot with refs, navigation, clicking, typing, screenshots.
 *
 * What bounds the agent is the workspace cwd and the denied tools, not a
 * per-action prompt. There is no human at a headless run to answer one, and a
 * denial surfaces as an honest refusal in Slack rather than a stall.
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
  // brave-repl: the same browser again, but its snapshot returns a DIFF.
  // Measured on Google Calendar: 5415 bytes for the full tree against 227 for
  // the diff after opening a menu. Re-reading a page is the most repeated thing
  // the agent does, so this is where the tokens are.
  'mcp__brave-repl',
  'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'WebFetch', 'WebSearch',
];

/** Threads run one at a time; this caps how many threads run together. */
const DEFAULT_CONCURRENCY = 3;

/**
 * Channels the agent will answer in. `*` means any channel it has been invited
 * to, which is already gated by Slack: it only receives `app_mention` from
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
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    // First run lands here. A bare ENOENT tells someone who has never seen this
    // project nothing about what to do next.
    if (err.code === 'ENOENT') {
      throw new Error(
        `No config at ${path}\n\n` +
          `  mkdir -p ${dirname(path)}\n` +
          `  cp bridge/config.example/* ${dirname(path)}/\n` +
          `  chmod 600 ${path}\n\n` +
          `Then fill in SLACK_BOT_TOKEN, SLACK_APP_TOKEN and ALLOWED_USER. ` +
          `Set AGENT_ENV_PATH to use a different location.`,
      );
    }
    throw err;
  }
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
 * text.mjs predates this runner, which returned
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
        text: '❌ The bridge restarted while this was running. Ask me again.',
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
    // Route on what the user typed, then strip the routing marker so the model is
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

        // Record the mapping BEFORE the run, not after a successful one.
        //
        // Claude Code creates the session the moment it starts, whatever the
        // outcome. Recording only on success meant a run that timed out left no
        // mapping, so the next message in that thread saw no session, assigned
        // the same deterministic id again, and hit a session that already
        // existed. Seen in production 2026-08-27, two messages after a ten
        // minute timeout: "Session ID de620be8-a781-4d68-8831-35a44e0555b7 is
        // already in use."
        //
        // If the spawn fails outright no session exists, and the next run's
        // `--resume` reports it gone, which the dead-session path below handles.
        if (isNew) await sessions.set(threadTs, sessionId);

        // Clear any target that has stopped answering CDP before handing over.
        //
        // All three browser servers connect by enabling Runtime and Network on
        // every target, so one wedged target times out every browser call the
        // agent makes and there is nothing it can do about it from the inside.
        // Measured 2026-08-27: one stuck Calendar tab and three of WhatsApp
        // Web's WASM VoIP workers took the whole browser layer down for a full
        // run. See browser-health.mjs.
        try {
          const health = await healBrowser({});
          if (health.healed) console.log(`[browser-health] cleared ${health.healed} wedged target(s)`);
        } catch (err) {
          console.warn(`[browser-health] preflight failed, continuing: ${err.message}`);
        }

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

        // Belt and braces for the same failure arriving another way: if the id
        // is taken, the session exists and we should have resumed it.
        if (!result.ok && result.sessionInUse) {
          console.log(`[agent] ${sessionId} already exists; resuming instead`);
          await sessions.set(threadTs, sessionId);
          result = await runAgent({
            prompt: task + '\n\n---\n\n' + note,
            sessionId,
            isNew: false,
            cwd: WORKSPACE,
            model: route.model,
            effort: route.effort,
            mcpConfig: MCP_CONFIG,
            allowedTools: ALLOWED_TOOLS,
          });
        }

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

  // Refuse to become a second answering bridge. Slack fans app_mention out to
  // every Socket Mode connection, so a duplicate does not error, it just makes
  // the agent look like it contradicts itself.
  const lock = await acquire();
  if (!lock.ok) {
    console.error(
      `[agent] another bridge holds the lock: pid ${lock.holder.pid} on ` +
      `${lock.holder.host} since ${lock.holder.since}. Refusing to start, because ` +
      `two bridges answer every mention twice. Stop that one first.`,
    );
    process.exit(1);
  }
  if (lock.tookOver) console.log('[agent] took over a stale lock from a dead process');
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => { release().finally(() => process.exit(0)); });
  }

  await app.start();
  console.log(`[agent] connected as ${auth.user} (${botUserId}) in ${auth.team}`);
  console.log(`[agent] workspace ${WORKSPACE}, concurrency ${concurrency}, channels ${ALLOWED_CHANNEL || '*'}`);
}

main().catch((err) => {
  console.error('[agent] fatal:', err.message);
  process.exit(1);
});
