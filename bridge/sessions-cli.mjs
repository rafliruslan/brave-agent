#!/usr/bin/env node
/**
 * See past agent sessions, and get the command to resume one.
 *
 * Slack threads have been the only way to look at what the agent did, and they
 * are a poor list: no overview, and a thread scrolls away. The sessions
 * themselves are Claude Code transcripts under ~/.claude/projects, keyed by the
 * same ids the bridge already computes from a thread ts.
 *
 * Read-only. It writes nothing, resumes nothing, and starts no browser.
 *
 *   node bridge/sessions-cli.mjs            # 20 most recent
 *   node bridge/sessions-cli.mjs -n 50
 *   node bridge/sessions-cli.mjs --json
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { summarise, threadIndex, relativeAge } from './transcript.mjs';
import { DEFAULT_STATE_PATH } from './sessions.mjs';

const WORKSPACE = process.env.AGENT_WORKSPACE
  || join(homedir(), '.local', 'share', 'brave-agent', 'workspace');

/**
 * Claude Code stores a project's transcripts under a slug of its cwd, with
 * every non-alphanumeric run replaced by a dash. The bridge runs the agent with
 * cwd = the workspace, so that path is what identifies the sessions.
 */
function projectDir(cwd) {
  return join(homedir(), '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
}

/**
 * A Slack permalink. The workspace host is not in the transcript, so it comes
 * from SLACK_WORKSPACE when set; without it the archives path still opens from
 * any signed-in Slack.
 */
function permalink({ channel, threadTs }) {
  const host = process.env.SLACK_WORKSPACE || 'app';
  return `https://${host}.slack.com/archives/${channel}/p${threadTs.replace('.', '')}`;
}

function parseArgs(argv) {
  const out = { limit: 20, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '-n' || a === '--limit') out.limit = Number(argv[++i]) || out.limit;
    else if (a === '-h' || a === '--help') out.help = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('usage: sessions-cli.mjs [-n LIMIT] [--json]');
    return;
  }

  const dir = projectDir(WORKSPACE);
  let files;
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.jsonl'));
  } catch {
    console.error(`No sessions found. Looked in ${dir}`);
    console.error(`(derived from AGENT_WORKSPACE=${WORKSPACE})`);
    process.exit(1);
  }

  let threads = {};
  try {
    threads = JSON.parse(await readFile(DEFAULT_STATE_PATH, 'utf8'));
  } catch {
    // The store prunes after a week and may not exist at all. Sessions still
    // list; they just lose their Slack link.
  }
  const index = threadIndex(threads);

  const rows = [];
  for (const f of files) {
    const path = join(dir, f);
    const id = basename(f, '.jsonl');
    const { mtimeMs } = await stat(path);
    const s = summarise(id, await readFile(path, 'utf8').catch(() => ''));
    // Prefer the channel and thread the prompt names: it carries the channel
    // too, and it survives threads.json's weekly prune. The hash index is the
    // fallback for a transcript whose prompt did not say.
    const threadTs = s.slack?.threadTs || index[id] || null;
    rows.push({ ...s, when: mtimeMs, threadTs, channel: s.slack?.channel || null });
  }
  rows.sort((a, b) => b.when - a.when);
  const shown = rows.slice(0, args.limit);

  if (args.json) {
    console.log(JSON.stringify(shown, null, 2));
    return;
  }

  if (shown.length === 0) {
    console.log(`No sessions in ${dir}`);
    return;
  }

  const age = (r) => relativeAge(r.when);
  const wAge = Math.max(...shown.map((r) => age(r).length));
  for (const r of shown) {
    console.log(
      `${age(r).padEnd(wAge)}  ${String(r.turns).padStart(3)} turns  ` +
      `${r.id.slice(0, 8)}  ${r.task || '(no task recorded)'}`,
    );
    if (r.channel && r.threadTs) {
      console.log(`${' '.repeat(wAge)}  ${permalink(r)}`);
    }
  }

  console.log(`\n${shown.length} of ${rows.length} sessions in ${dir}`);
  console.log(`Resume one:  cd ${WORKSPACE} && claude --resume <id>`);
  // Said here rather than discovered later: the transcript is the same, the
  // authority is not. The bridge runs the agent with its own allowlist and
  // acceptEdits; a terminal resume runs as you, with your MCP config.
  console.log('That replays the same conversation as YOU, with your own MCP config');
  console.log('and permissions, not the bridge\'s tool allowlist.');
}

await main();
