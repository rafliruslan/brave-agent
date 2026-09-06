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
  // Not trimmed yet: trimming here would pull a trailing line up onto the
  // first one, and "!\n*Sent using* ..." would stop looking like a bare "!".
  const afterMarker = body.replace(/^!+/, '');
  const rest = afterMarker.trim();

  // A stop is decided on the FIRST LINE alone. Slack appends an attribution
  // line to messages sent through some apps, so "!stop" arrives as
  // "!stop\n*Sent using* <@U0A8...>"; matching the whole body sent that to
  // steer, which killed the run and immediately started another one with
  // "stop" as its task. Seen live.
  const firstLine = afterMarker.split('\n')[0].trim();
  if (firstLine === '' || /^stop$/i.test(firstLine)) return { stop: true, prompt: null };

  // Anything else keeps every line: a steered instruction is often more than
  // one, and trimming it to the first would silently drop half the request.
  return { stop: false, prompt: rest };
}
