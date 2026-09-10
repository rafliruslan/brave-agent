/**
 * Our own transcript, mirrored from the CLI's stream.
 *
 * Until now the only record of a run was Claude Code's own JSONL under
 * ~/.claude/projects/<slug>/<uuid>.jsonl, and sessions-cli reads it. That works
 * until the CLI changes its schema or rotates a file, and then the whole
 * session list breaks. So the supervisor writes its own copy from
 * `--output-format stream-json`, and owns the format it reads.
 *
 * It also makes the runs index fall out for free. The offset is the file length
 * before a turn and the size is what the turn appended, and because this
 * supervisor is the only writer the ranges are contiguous - Aside's are not,
 * and their own advice was never to compute a turn's size from the next turn's
 * offset because of it.
 *
 * The parsing lives here as pure functions, because the awkward cases are all
 * about bytes arriving badly: an object split across two chunks, and a final
 * line cut in half when !stop kills the run.
 */
import { appendFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Where a session's transcript lives.
 *
 * One file per session under the workspace, named by the session id, so the
 * bridge and sessions-cli agree on the location without passing paths around.
 */
export function transcriptPathFor(workspace, sessionId) {
  return join(workspace, 'transcripts', `${sessionId}.jsonl`);
}

/**
 * Worth keeping in a transcript.
 *
 * An allowlist. A denylist would have to be right about every event type a
 * later CLI invents, and being wrong there means silently mirroring noise.
 * Measured on a one-line run: 13 of 17 lines were hook chatter.
 */
export function keepLine(obj) {
  const type = obj?.type;
  if (type === 'assistant' || type === 'user' || type === 'result') return true;
  // init records what the run was given - model, tools, mcp servers, cwd,
  // permission mode - which is what you want when asking later why a turn
  // behaved the way it did.
  if (type === 'system' && obj?.subtype === 'init') return true;
  return false;
}

/**
 * Split a stream chunk into whole lines, carrying the remainder.
 *
 * The unterminated tail is never emitted. A run killed mid-write ends on half
 * an object, and writing that into a transcript we claim to own would corrupt
 * the very thing this exists to make trustworthy.
 *
 * @returns {{lines: string[], rest: string}}
 */
export function splitLines(buffered, chunk) {
  const all = `${buffered}${chunk}`;
  const parts = all.split('\n');
  const rest = parts.pop() ?? '';
  return { lines: parts.filter((l) => l.length > 0), rest };
}

/**
 * The run's result line, or null when it never produced one.
 *
 * Null is the killed-run case, and the caller must be able to tell it from a
 * run that finished and failed. The last one wins: if a future CLI ever emits
 * more than one, the final state is the one that describes the run.
 */
export function resultOf(objects) {
  let found = null;
  for (const o of objects) if (o?.type === 'result') found = o;
  return found;
}

/**
 * How much of a tool result to keep.
 *
 * Enough to see what came back when reading a turn later, nowhere near enough
 * to hold a page snapshot. Measured on a real browsing session: tool results
 * were 8.5MB of the 8.67MB of block content, averaging 89KB each, and the file
 * came to 17.4MB for five turns. Everything else - thinking, tool_use, text -
 * totalled 162KB and is kept whole.
 *
 * This transcript is not what `claude --resume` replays; Claude Code keeps its
 * own copy for that. Ours exists to be listed and indexed, and neither needs
 * the bytes of a page.
 */
export const TOOL_RESULT_LIMIT = 2000;

function trimText(text) {
  if (typeof text !== 'string' || text.length <= TOOL_RESULT_LIMIT) return text;
  return `${text.slice(0, TOOL_RESULT_LIMIT)}\n… [${text.length - TOOL_RESULT_LIMIT} more characters not kept]`;
}

/** One block of a tool result, cut to size. Images go entirely. */
function trimResultBlock(block) {
  if (block?.type === 'image') {
    // Base64 screenshots, the single largest thing in a transcript. A note
    // that one was returned is worth keeping; the pixels are not.
    const bytes = block?.source?.data?.length ?? 0;
    return { type: 'text', text: `[image not kept, ${bytes} characters of base64]` };
  }
  if (typeof block?.text === 'string') return { ...block, text: trimText(block.text) };
  return block;
}

/**
 * A copy of a record with its tool results cut down.
 *
 * Two places hold the payload, and both must go or neither is worth doing.
 * `message.content[].tool_result` is the one the model saw, and the record
 * ALSO carries a top-level `tool_use_result` holding the same bytes again.
 * Trimming only the first halved a real transcript where it should have cut
 * 95% of it; the duplicate is dropped outright, since a transcript we keep for
 * listing and indexing has no use for either copy of a page.
 *
 * Returns the original object when nothing needs trimming, so the common case
 * copies nothing. Never mutates its input: the caller reads the parsed object
 * back for the run's result.
 */
export function trimRecord(obj) {
  const content = obj?.message?.content;
  const hasResult = Array.isArray(content) && content.some((b) => b?.type === 'tool_result');
  const hasDuplicate = obj != null && typeof obj === 'object' && 'tool_use_result' in obj;
  if (!hasResult && !hasDuplicate) return obj;

  const { tool_use_result: _dropped, ...rest } = obj;
  if (!hasResult) return rest;

  return {
    ...rest,
    message: {
      ...obj.message,
      content: content.map((b) => {
        if (b?.type !== 'tool_result') return b;
        if (typeof b.content === 'string') return { ...b, content: trimText(b.content) };
        if (Array.isArray(b.content)) return { ...b, content: b.content.map(trimResultBlock) };
        return b;
      }),
    },
  };
}

/**
 * Collect one turn's transcript lines.
 *
 * Deliberately synchronous. An earlier version opened the file first and only
 * then began taking lines, and the CLI's first chunks routinely won that race -
 * the init line vanished from every transcript. Nothing here touches the disk,
 * so there is no window to lose lines in.
 *
 * Buffered and written once by writeTo rather than appended per line: a turn is
 * seconds to minutes of work, and one write keeps the byte count honest even if
 * the process dies - a partial turn then contributes nothing rather than a
 * length that lies about what is there.
 */
export function createMirror() {
  const kept = [];

  return {
    /**
     * Consider one raw line. Returns the parsed object when it parses, so the
     * caller can read the result without parsing a second time, and null when
     * it does not.
     */
    take(line) {
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        return null;
      }
      if (keepLine(obj)) {
        const trimmed = trimRecord(obj);
        kept.push(trimmed === obj ? line : JSON.stringify(trimmed));
      }
      return obj;
    },

    /**
     * Add a record we wrote ourselves, held to the same allowlist.
     *
     * The stream never echoes the prompt back - its `user` events are tool
     * results - so without this a transcript says what the agent did and
     * nothing about what it was asked. Every mirrored session listed as
     * "(no task recorded)" and lost its Slack permalink with it, since both
     * are read off the prompt. Claude Code's own transcript opens with this
     * same shape, so ours stays readable by the same code.
     */
    record(obj) {
      if (keepLine(obj)) kept.push(JSON.stringify(trimRecord(obj)));
      return obj;
    },

    /**
     * Append the turn, and report the range it occupies.
     *
     * `offset` is the file's length before this write and `bytes` is what the
     * write added. Together they are the runs index entry, with no separate
     * bookkeeping to drift from the file. Taking the offset here rather than at
     * open is safe because the supervisor is the only writer and never runs a
     * session twice at once.
     */
    async writeTo(path) {
      await mkdir(dirname(path), { recursive: true });
      let offset = 0;
      try {
        offset = (await stat(path)).size;
      } catch {
        // No transcript yet. Starting at zero is right.
      }
      if (kept.length === 0) return { offset, bytes: 0 };
      const body = `${kept.join('\n')}\n`;
      await appendFile(path, body);
      return { offset, bytes: Buffer.byteLength(body) };
    },
  };
}
