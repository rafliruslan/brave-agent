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
      if (keepLine(obj)) kept.push(line);
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
