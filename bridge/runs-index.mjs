/**
 * Where each turn's bytes are in a transcript.
 *
 * The listing reads every transcript whole to pull one task line and count
 * turns. That is the wrong shape of work: the task line is in the first few
 * hundred bytes of the file, and the count is a property of how many times the
 * agent ran, not of how much it said.
 *
 * So each turn appends where it wrote. The runner already computes the range -
 * the file length before the write and the bytes it added - and until now threw
 * it away. Because this supervisor is the only writer the ranges are
 * contiguous, which is what makes reading one turn a plain seek. Aside's are
 * not contiguous, and their advice was never to derive a turn's size from the
 * next turn's offset because of it; we do not need to, since the size is
 * recorded.
 *
 * Deliberately not recorded: whether the turn succeeded, and what it cost.
 * Both are already in the transcript's own result line, and an index that
 * repeats them is an index that can disagree with them.
 */
import { appendFile, mkdir, open, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * The index for a workspace.
 *
 * It sits beside the transcripts rather than inside one, so a session's file
 * stays pure JSONL of the conversation.
 */
export function indexPathIn(workspace) {
  return join(workspace, 'transcripts', 'index.jsonl');
}

/** The same index, named from a transcript the runner is already writing. */
export function indexPathFor(transcriptPath) {
  return join(dirname(transcriptPath), 'index.jsonl');
}

/**
 * Record one turn.
 *
 * Append-only and one line per turn: a crash costs the entry for the turn that
 * was in flight, never the entries already written. A turn that wrote nothing -
 * killed before its first kept line - is skipped rather than recorded as a
 * zero-length range nothing can be read from.
 */
export async function appendRun(path, { session, offset, bytes, at = new Date() }) {
  if (!session || !bytes) return false;
  await mkdir(dirname(path), { recursive: true });
  const entry = { session, offset, bytes, at: new Date(at).toISOString() };
  await appendFile(path, `${JSON.stringify(entry)}\n`);
  return true;
}

/**
 * Every recorded turn, oldest first. A missing or unreadable index is empty:
 * the listing falls back to reading transcripts whole, which is what it did
 * before this existed.
 */
export async function readIndex(path) {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry?.session && Number.isInteger(entry.bytes)) out.push(entry);
    } catch {
      // A half-written final line costs that line, not the index.
    }
  }
  return out;
}

/** Turns per session, keyed by session id. */
export function groupBySession(entries) {
  const out = new Map();
  for (const e of entries) {
    const list = out.get(e.session);
    if (list) list.push(e);
    else out.set(e.session, [e]);
  }
  for (const list of out.values()) list.sort((a, b) => a.offset - b.offset);
  return out;
}

/**
 * Read just one turn out of a transcript.
 *
 * The point of the whole module. Reading 400KB to render a 100-character task
 * line was the thing worth fixing, and it only gets worse as a thread runs.
 */
export async function readRange(path, offset, bytes) {
  let handle;
  try {
    handle = await open(path, 'r');
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buf, 0, bytes, offset);
    return buf.subarray(0, bytesRead).toString('utf8');
  } catch {
    return '';
  } finally {
    await handle?.close();
  }
}
