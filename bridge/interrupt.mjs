/**
 * Interrupting a run in flight.
 *
 * A reply in a busy thread queues behind the run, which is right for a
 * follow-up and useless for "no, not that". Aside splits the two: `queue`
 * waits, `steer` cuts in. This is the same split, chosen by the sender rather
 * than guessed from the text.
 *
 * Ours is coarser than Aside's on purpose, because it has to be. Aside injects
 * a steering message into a live run at the next tool boundary; the runner here
 * spawns `claude -p` with stdin ignored - deliberately, per the comment in
 * runner.mjs - so there is no channel into a running one-shot. So an interrupt
 * kills the child and starts the next turn. The conversation survives, because
 * the session id is derived from the thread and resumes; only the in-flight
 * step is lost.
 *
 * The marker is a leading `!` and nothing else. "stop the deploy" is a task,
 * and a design that read intent out of ordinary words would eat it.
 */

/** Slack puts `<@Uxxxx>` in front of a mention. Not part of what was said. */
const LEADING_MENTION = /^\s*<@[^>]+>\s*/;

/**
 * @returns {{stop: boolean, prompt: string|null}|null} null when the message is
 *   not an interrupt at all.
 */
export function parseInterrupt(text) {
  const body = String(text ?? '').replace(LEADING_MENTION, '').trim();
  if (!body.startsWith('!')) return null;

  // Only the first `!` is the marker. `!!` is someone leaning on the key, not
  // an instruction named "!".
  const rest = body.replace(/^!+/, '').trim();
  if (rest === '' || /^stop$/i.test(rest)) return { stop: true, prompt: null };
  return { stop: false, prompt: rest };
}
